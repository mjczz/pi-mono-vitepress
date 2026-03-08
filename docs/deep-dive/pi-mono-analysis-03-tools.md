# pi-mono 工具调用系统快速扫描

**创建时间**: 2026-02-09 00:25 GMT+8
**任务编号**: #3
**类型**: 快速扫描概览

---

## 核心设计

### 工具定义（TypeBox）

所有工具都使用 **TypeBox** 定义参数模式：

```typescript
import { Type, StringEnum } from "@sinclair/typebox";

interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;                      // LLM 调用的工具名
  label: string;                     // UI 显示标签
  description: string;                 // LLM 工具描述
  parameters: TParams;                 // TypeBox 参数模式

  // 执行函数
  execute(
    toolCallId: string,
    params: Static<TParams>,  // 验证后的参数
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult<TDetails>>;

  // 自定义渲染
  renderCall?: (args: Static<TParams>, theme: Theme) => Component;
  renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component;
}
```

**TypeBox 参数示例**：

```typescript
{
  name: "bash",
  label: "Bash",
  description: "Execute shell commands",
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
    timeout: Type.Optional(Type.Number({ minimum: 1, description: "Timeout in seconds" }))
  })
}
```

---

## 内置工具

### 1. Bash

**功能**：执行 shell 命令

**参数**：
```typescript
{
  command: string;      // 必需：命令
  cwd?: string;        // 可选：工作目录
  timeout?: number;      // 可选：超时秒数
}
```

**特性**：
- ✅ 支持流式输出
- ✅ 支持超时控制
- ✅ 支持自定义工作目录
- ✅ 支持用户扩展：`!!command`（不发送到 LLM）

### 2. Read

**功能**：读取文件内容

**参数**：
```typescript
{
  path: string;           // 必需：文件路径
  maxBytes?: number;      // 可选：最大字节数
  maxLines?: number;      // 可选：最大行数
  offset?: number;        // 可选：偏移字节数
}
```

**特性**：
- ✅ 自动检测图片 MIME 类型
- ✅ 自动压缩（maxBytes/maxLines）
- ✅ 支持大文件截断
- ✅ 返回格式化输出

### 3. Write

**功能**：写入文件

**参数**：
```typescript
{
  path: string;      // 必需：文件路径
  content: string;   // 必需：文件内容
  overwrite?: boolean; // 可选：覆盖模式
}
```

**特性**：
- ✅ 自动创建目录
- ✅ 默认追加模式（不覆盖）
- ✅ 支持覆盖模式

### 4. Edit

**功能**：精确编辑文件

**参数**：
```typescript
{
  path: string;        // 必需：文件路径
  oldText: string;    // 必需：要替换的旧文本
  newText: string;    // 必需：新文本
  retries?: number;   // 可选：重试次数
}
```

**特性**：
- ✅ 精确文本匹配（行号 + 偏移）
- ✅ 失败自动重试
- ✅ 多文件编辑支持

### 5. Grep

**功能**：搜索文件内容

**参数**：
```typescript
{
  path: string;              // 必需：搜索路径
  pattern: string;           // 必需：搜索模式（支持正则）
  includePatterns?: string[]; // 可选：文件匹配模式
  excludePatterns?: string[]; // 可选：排除模式
}
```

**特性**：
- ✅ 支持正则表达式
- ✅ 支持 glob 模式
- ✅ 流式搜索结果

### 6. Find

**功能**：查找文件

**参数**：
```typescript
{
  path: string;              // 必需：搜索路径
  namePatterns?: string[];   // 可选：文件名模式
  maxDepth?: number;        // 可选：最大深度
}
```

**特性**：
- ✅ 支持 glob 模式
- ✅ 递归搜索
- ✅ 深度限制

### 7. Ls

**功能**：列出目录

**参数**：
```typescript
{
  path: string;       // 必需：路径
  depth?: number;     // 可选：深度
  showHidden?: boolean; // 可选：显示隐藏文件
}
```

**特性**：
- ✅ 递归列表
- ✅ 深度限制
- ✅ 隐藏文件控制

---

## 工具验证

### TypeBox 参数验证

```typescript
import { validateToolCall } from "@mariozechner/pi-ai";

const tools: Tool[] = [readTool, writeTool, bashTool];

// 验证工具调用
const validatedArgs = validateToolCall(tools, toolCall);
// 如果验证失败，错误会作为工具结果返回给 LLM
```

**验证失败示例**：

```json
{
  "toolCallId": "call_123",
  "toolName": "bash",
  "arguments": { "command": "ls -la" },
  "validationError": "Invalid arguments: timeout must be >= 1, got -5"
}
```

### 类型守卫

```typescript
// 使用 isToolCallEventType 进行类型守卫
if (isToolCallEventType("bash", event)) {
  event.input.command;  // TypeScript 知道这是 string
}
```

---

## 流式更新

### onUpdate 回调

```typescript
onUpdate?: AgentToolUpdateCallback<TDetails>;

// 回调函数签名
type AgentToolUpdateCallback<TDetails = unknown> = (
  result: {
    content: (TextContent | ImageContent)[];
    details?: TDetails;
  }
) => void;
```

**使用示例**：

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  // 1. 发送开始通知
  onUpdate?.({
    content: [{ type: "text", text: "Starting..." }],
    details: { progress: 0 }
  });

  // 2. 执行步骤 1
  await step1(params);
  onUpdate?.({
    content: [{ type: "text", text: "Step 1 complete" }],
    details: { progress: 25 }
  });

  // 3. 执行步骤 2
  await step2(params);
  onUpdate?.({
    content: [{ type: "text", text: "Step 2 complete" }],
    details: { progress: 50 }
  });

  // 4. 完成
  return {
    content: [{ type: "text", text: "Done" }],
    details: { progress: 100 }
  };
}
```

### UI 渲染

```typescript
// 自定义工具调用渲染
renderCall(args, theme) {
  return html`
    <div class="border ${theme.border} p-2 rounded">
      <div class="font-bold ${theme.primary}">Deploy ${args.service}</div>
      <div class="text-sm text-gray-500">
        Target: ${args.environment} |
        Tests: ${args.skipTests ? '❌' : '✅'}
      </div>
    </div>
  `;
}

// 自定义结果渲染
renderResult(result, options, theme) {
  const { deploymentId } = result.details ?? {};
  return html`
    <div class="p-2 bg-green-900 text-green-100 rounded">
      <div class="font-bold">✓ Success</div>
      <div class="text-sm mt-1">ID: ${deploymentId}</div>
    </div>
  `;
}
```

---

## 工具调用事件

### tool_call 事件

```typescript
// 工具调用前触发
pi.on("tool_call", async (event, ctx) => {
  // 可以阻止工具执行
  if (event.toolName === "bash" && isDangerous(event.input.command)) {
    return {
      block: true,
      reason: "Dangerous command blocked by extension"
    };
  }

  // 可以修改参数
  if (event.toolName === "read") {
    // 添加默认路径
    event.input.path = resolvePath(event.input.path);
  }
});
```

### tool_result 事件

```typescript
// 工具执行后触发
pi.on("tool_result", async (event, ctx) => {
  // 可以修改结果
  if (event.toolName === "grep") {
    const formatted = formatGrepOutput(event.content);
    return {
      content: formatted,
      isError: false
    };
  }

  // 可以格式化错误
  if (event.isError) {
    return {
      content: [{ type: "text", text: `Error: ${event.content[0].text}` }],
      isError: true
    };
  }
});
```

---

## 扩展工具

### 注册自定义工具

```typescript
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "deploy_to_production",
    label: "Deploy to Production",
    description: "Deploy application to production servers",
    parameters: Type.Object({
      service: Type.String({
        description: "Service name",
        enum: ["web-api", "worker", "cron-job"]
      }),
      environment: Type.String({
        description: "Target environment",
        default: "production",
        enum: ["production", "staging"]
      }),
      skipTests: Type.Boolean({
        description: "Skip test suite",
        default: false
      })
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 工具逻辑
      await deploy(params);

      return {
        content: [{ type: "text", text: "Deployment successful" }],
        details: { deploymentId: "deploy-123" }
      };
    }
  });
}
```

### 工具替换

```typescript
// 扩展可以完全替换内置工具
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    // 自定义 bash 实现
    const result = await myCustomBash(event.input);
    return { content: result };
  }
});
```

---

## 核心优势

### 1. 类型安全
- TypeBox 模式定义
- 编译时类型检查
- 运行时参数验证

### 2. 流式支持
- `onUpdate` 回调实时更新
- 适用于长时间运行的任务
- UI 实时显示进度

### 3. 自定义渲染
- `renderCall` 控制工具调用显示
- `renderResult` 控制结果显示
- 完全自定义 UI

### 4. 事件拦截
- `tool_call` 事件可以阻止或修改
- `tool_result` 事件可以修改结果
- 扩展可以实现权限控制、日志记录等

### 5. 完整的工具集
- 7 个内置工具覆盖常见操作
- 无需编写基础工具即可使用
- 易于扩展

---

## 关键源码文件

- `packages/coding-agent/src/core/tools/` - 所有工具实现
- `packages/coding-agent/src/core/tools/index.ts` - 工具导出
- `packages/coding-agent/src/core/extensions/types.ts` - 工具类型定义

---

**下一步**: 深度分析工具调用系统（验证算法、流式机制、错误处理）
