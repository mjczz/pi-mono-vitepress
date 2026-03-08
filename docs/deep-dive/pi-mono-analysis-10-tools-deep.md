# pi-mono 工具调用系统深度分析

**创建时间**: 2026-02-09 06:47 GMT+8
**任务编号**: #3
**类型**: 深度分析
**分析文件**: 
- `packages/coding-agent/src/core/tools/` (所有工具实现)
- `packages/coding-agent/src/core/tools/index.ts` (工具导出)
- `packages/ai/src/utils/validation.ts` (验证逻辑)
- `packages/agent/src/types.ts` (AgentTool 类型定义)

---

## 目录

1. [工具定义架构](#工具定义架构)
2. [TypeBox 参数验证](#typebox-参数验证)
3. [工具执行流程](#工具执行流程)
4. [流式更新机制](#流式更新机制)
5. [内置工具详解](#内置工具详解)
6. [工具验证](#工具验证)
7. [自定义工具扩展](#自定义工具扩展)
8. [性能优化](#性能优化)

---

## 工具定义架构

### 核心接口

```typescript
interface AgentTool<TParams, TDetails = unknown> {
  // 基本信息
  name: string;                           // 工具唯一标识符
  label: string;                          // UI 显示标签
  description: string;                      // LLM 工具描述
  
  // 参数定义
  parameters: TSchema;                     // TypeBox 模式
  
  // 执行函数
  execute(
    toolCallId: string,
    params: Static<TParams>,                // 验证后的参数
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult<TDetails>>;
  
  // 可选：自定义渲染
  renderCall?: (
    args: Static<TParams>,
    theme: Theme
  ) => Component;
  
  renderResult?: (
    result: AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme
  ) => Component;
}
```

### 工具结果

```typescript
interface AgentToolResult<TDetails = unknown> {
  // 内容（发送给 LLM）
  content: (TextContent | ImageContent)[];
  
  // 可选：扩展数据（不发送给 LLM）
  details?: TDetails;
  
  // 可选：错误标记
  isError?: boolean;  // 如果为 true，content 会作为错误处理
}
```

### 内容块类型

```typescript
// 文本内容
interface TextContent {
  type: "text";
  text: string;
}

// 图片内容
interface ImageContent {
  type: "image";
  data: string;           // base64 编码
  mimeType: string;      // image/jpeg, image/png 等
}

// 工具调用内容块
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// 工具结果内容块
interface ToolResultContent {
  type: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
}
```

---

## TypeBox 参数验证

### 验证流程

```typescript
// 1. 工具定义时使用 TypeBox 定义参数模式
import { Type, StringEnum, Static } from "@sinclair/typebox";

const readTool: AgentTool = {
  name: "read",
  label: "Read File",
  description: "Read the contents of a file",
  parameters: Type.Object({
    path: Type.String({ description: "File path to read" }),
    maxBytes: Type.Optional(
      Type.Number({ 
        minimum: 0,
        description: "Maximum bytes to read"
      })
    ),
    maxLines: Type.Optional(
      Type.Number({ 
        minimum: 0,
        description: "Maximum lines to read"
      })
    )
  })
};

// 2. LLM 调用工具时返回参数
const toolCallParams = {
  path: "/path/to/file.txt",
  maxBytes: 10240
};

// 3. pi-ai 验证参数
import { validateToolCall } from "@mariozechner/pi-ai";

const { success, data, errors } = validateToolCall([readTool], toolCallParams);

if (success) {
  // data 是验证后的参数
  const { path, maxBytes } = data;
  // 执行工具
  await readTool.execute(toolCallId, { path, maxBytes }, signal, onUpdate, ctx);
} else {
  // errors 包含详细的验证错误信息
  console.error("Validation errors:", errors);
  // 将错误作为工具结果返回给 LLM
  return {
    content: [{ type: "text", text: `Validation errors: ${errors.join(", ")}` }],
    isError: true
  };
}
```

### TypeBox 模式示例

```typescript
import { Type, StringEnum, Array, Optional } from "@sinclair/typebox";

// 1. 基本类型
Type.String({ description: "Name" });
Type.Number({ description: "Age", minimum: 0, maximum: 150 });
Type.Boolean({ description: "Enabled" });

// 2. 枚举
StringEnum(["red", "green", "blue"], { 
  default: "blue",
  description: "Color preference"
});

// 3. 可选参数
Type.Optional(Type.String({ description: "Optional description" }));

// 4. 数组
Type.Array(Type.String(), { 
  minItems: 1,
  maxItems: 10,
  description: "List of file names"
});

// 5. 对象
Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Number({ minimum: 0, maximum: 150 }),
  skills: Type.Array(StringEnum(["coding", "design", "writing"])),
  metadata: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Union([Type.String(), Type.Number()])
    )
  )
});

// 6. 联合类型
Type.Union([
  Type.Object({ path: Type.String() }),
  Type.Object({ url: Type.String({ format: "uri" }) })
], {
  description: "Either local path or remote URL"
});

// 7. 正则表达式
Type.RegEx(/^[a-z0-9]+$/i, { 
  description: "Alphanumeric ID only"
});

// 8. 自定义验证
Type.Custom<string>([
  (value, context) => {
    if (value.length < 3) return { kind: false, message: "Too short" };
    return { kind: true, message: "Valid" };
  },
  { type: "string", description: "Email must be valid" }
]);
```

---

## 工具执行流程

### 1. 工具调用解析

```typescript
// LLM 响应中的工具调用
interface LLMToolCall {
  id: string;                             // 工具调用 ID
  name: string;                           // 工具名称
  arguments: Record<string, unknown>;    // 参数 JSON
}

// 从 AssistantMessage 中提取工具调用
const extractToolCalls = (message: AssistantMessage): LLMToolCall[] => {
  const toolCalls: LLMToolCall[] = [];
  
  for (const block of message.content) {
    if (block.type === "toolCall") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.arguments
      });
    }
  }
  
  return toolCalls;
};
```

### 2. 参数验证

```typescript
// pi-ai 的 validateToolCall 函数
import { validateToolCall } from "@mariozechner/pi-ai";

// 验证流程：
// 1. 查找工具定义
// 2. 获取工具的 parameters 模式
// 3. 验证输入参数符合模式
// 4. 返回验证后的参数或错误

interface ValidationResult {
  success: boolean;
  data?: Record<string, unknown>;    // 验证后的参数
  errors?: string[];                 // 错误消息列表
}

const result: ValidationResult = validateToolCall(tools, toolCall);

if (result.success) {
  // 验证通过，执行工具
  const { name, arguments: params } = result.data;
  const tool = getTool(name);
  await tool.execute(toolCall.id, params, signal, onUpdate, ctx);
} else {
  // 验证失败，返回错误
  console.error("Tool validation failed:", result.errors);
}
```

### 3. 工具查找

```typescript
// 从工具名称查找工具定义
function getTool(name: string): AgentTool | undefined {
  // 1. 在内置工具中查找
  const builtInTool = builtInTools.get(name);
  if (builtInTool) return builtInTool;
  
  // 2. 在扩展注册的工具中查找
  const extensionTool = extensionTools.get(name);
  if (extensionTool) return extensionTool;
  
  // 3. 未找到工具
  return undefined;
}

// 工具优先级：内置工具 > 扩展工具
// 如果同名，内置工具优先
```

---

## 流式更新机制

### onUpdate 回调

```typescript
type AgentToolUpdateCallback<TDetails = unknown> = (
  result: {
    content: (TextContent | ImageContent)[];
    details?: TDetails;
  }
) => void;

// 使用示例
const readTool: AgentTool = {
  name: "read",
  parameters: Type.Object({
    path: Type.String()
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 1. 发送开始通知
    onUpdate?.({
      content: [{ type: "text", text: `Reading ${params.path}...` }],
      details: { progress: 0 }
    });
    
    try {
      // 2. 读取文件（可流式）
      const content = await readFile(params.path, {
        signal,
        onProgress: (progress) => {
          // 流式更新进度
          onUpdate?.({
            content: [{ type: "text", text: `Reading... ${progress}%` }],
            details: { progress }
          });
        }
      });
      
      // 3. 发送完成通知
      onUpdate?.({
        content: [{ type: "text", text: `Read ${content.length} bytes` }],
        details: { progress: 100, bytesRead: content.length }
      });
      
      // 4. 返回结果
      return {
        content: [{ type: "text", text: content }],
        details: { path: params.path, size: content.length }
      };
    } catch (error) {
      // 5. 发送错误通知
      onUpdate?.({
        content: [{ type: "text", text: `Error: ${error.message}` }],
        details: { error: error.message }
      });
      
      // 6. 返回错误
      throw error;
    }
  }
};
```

### UI 渲染更新

```typescript
// 流式更新触发 UI 重绘
// pi-tui 使用差分渲染，只更新变化的部分

// 工具调用开始渲染
renderToolCallStart(toolCall: LLMToolCall, theme: Theme): Component {
  return html`
    <div class="border ${theme.border} p-2 rounded">
      <div class="flex items-center gap-2">
        <div class="${theme.primary}">🔧</div>
        <div class="font-bold">${toolCall.name}</div>
        <div class="text-sm text-gray-500">executing...</div>
      </div>
    </div>
  `;
}

// 进度更新渲染
renderProgress(progress: number, details: any, theme: Theme): Component {
  return html`
    <div class="ml-4 p-1">
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="h-full bg-green-500 rounded-full" style="width: ${progress}%"></div>
      </div>
    </div>
  `;
}

// 结果渲染
renderToolResult(result: AgentToolResult, options: ToolRenderResultOptions, theme: Theme): Component {
  const { content, details, isError } = result;
  const { expanded } = options;
  
  if (isError) {
    return html`
      <div class="border border-red-500 bg-red-50 text-red-900 p-2 rounded">
        <div class="font-bold">❌ Error</div>
        <div>${content[0].text}</div>
      </div>
    `;
  }
  
  if (expanded) {
    // 展开显示详细内容
    return html`
      <div class="border ${theme.border} p-2 rounded">
        <div class="font-bold ${theme.primary}">${content[0].text}</div>
        <pre class="text-sm bg-gray-100 p-2 mt-2 rounded overflow-auto">${details ? JSON.stringify(details, null, 2) : ''}</pre>
      </div>
    `;
  } else {
    // 折叠显示
    return html`
      <div class="p-1 text-sm text-gray-600">
        ${content[0].text}
      </div>
    `;
  }
}
```

---

## 内置工具详解

### 1. Read 工具

```typescript
const readTool: AgentTool<ReadInput, ReadDetails> = {
  name: "read",
  label: "Read File",
  description: "Read the contents of a file or standard input",
  
  parameters: Type.Object({
    path: Type.String({ description: "Path to file or '-' for stdin" }),
    maxBytes: Type.Optional(Type.Number({ minimum: 0, description: "Max bytes to read" })),
    maxLines: Type.Optional(Type.Number({ minimum: 0, description: "Max lines to read" })),
    offset: Type.Optional(Type.Number({ minimum: 0, description: "Byte offset to start from" }))
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const { path, maxBytes, maxLines, offset } = params;
    
    // 1. 参数处理
    if (path === "-" || path === undefined) {
      return {
        content: [{ type: "text", text: "Please specify a file path" }]
      };
    }
    
    // 2. 文件存在性检查
    if (!existsSync(resolvePath(path, ctx.cwd))) {
      return {
        content: [{ type: "text", text: `File not found: ${path}` }],
        isError: true
      };
    }
    
    // 3. 读取文件
    const fullPath = resolvePath(path, ctx.cwd);
    let content = "";
    let bytesRead = 0;
    const fileSize = statSync(fullPath).size;
    
    if (offset !== undefined) {
      // 从偏移量读取
      const fd = openSync(fullPath, "r");
      readSync(fd, Buffer.allocUnsafe(maxBytes || fileSize - offset), 0, maxBytes || fileSize - offset);
      closeSync(fd);
    } else {
      // 读取整个文件
      const fileContent = readFileSync(fullPath, "utf-8");
      content = fileContent;
      bytesRead = fileContent.length;
    }
    
    // 4. 应用限制
    if (maxBytes && content.length > maxBytes) {
      content = content.slice(0, maxBytes);
      bytesRead = maxBytes;
    }
    
    if (maxLines && content.includes("\n")) {
      const lines = content.split("\n");
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join("\n");
        bytesRead = content.length;
      }
    }
    
    // 5. MIME 类型检测
    const mimeType = detectMimeType(fullPath);
    
    // 6. 返回结果
    return {
      content: [{ type: "text", text: content }],
      details: {
        path: fullPath,
        bytesRead,
        mimeType
      }
    };
  }
};
```

### 2. Write 工具

```typescript
const writeTool: AgentTool<WriteInput, WriteDetails> = {
  name: "write",
  label: "Write File",
  description: "Write content to a file",
  
  parameters: Type.Object({
    path: Type.String({ description: "File path to write" }),
    content: Type.String({ description: "Content to write" }),
    overwrite: Type.Optional(Type.Boolean({ 
      default: false,
      description: "Overwrite existing file"
    }))
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const { path, content, overwrite } = params;
    
    // 1. 路径解析
    const fullPath = resolvePath(path, ctx.cwd);
    
    // 2. 目录创建
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    // 3. 文件存在性检查
    if (!overwrite && existsSync(fullPath)) {
      return {
        content: [{ type: "text", text: `File already exists: ${path}` }],
        isError: true
      };
    }
    
    // 4. 写入文件
    try {
      writeFileSync(fullPath, content, "utf-8");
      
      return {
        content: [{ type: "text", text: `Wrote ${content.length} bytes to ${path}` }],
        details: { path: fullPath, bytesWritten: content.length }
      };
    } catch (error) {
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }
};
```

### 3. Edit 工具

```typescript
const editTool: AgentTool<EditInput, EditDetails> = {
  name: "edit",
  label: "Edit File",
  description: "Edit file content using exact text matching",
  
  parameters: Type.Object({
    path: Type.String({ description: "File path to edit" }),
    oldText: Type.String({ description: "Exact old text to replace" }),
    newText: Type.String({ description: "New text to insert" }),
    retries: Type.Optional(Type.Number({ 
      default: 3,
      minimum: 0,
      description: "Number of retries if match fails"
    }))
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const { path, oldText, newText, retries } = params;
    const fullPath = resolvePath(path, ctx.cwd);
    
    // 1. 读取文件
    const fileContent = readFileSync(fullPath, "utf-8");
    
    // 2. 精确匹配（按行号 + 偏移）
    const matchResult = findExactMatch(fileContent, oldText);
    
    if (!matchResult.found) {
      return {
        content: [{ type: "text", text: `Old text not found in file` }],
        isError: true,
        details: { oldText, fullText: fileContent }
      };
    }
    
    // 3. 替换文本
    const newContent = fileContent.slice(0, matchResult.start) + 
                        newText + 
                        fileContent.slice(matchResult.end);
    
    // 4. 重试逻辑
    if (retries > 0) {
      // 检查是否成功
      const success = newContent.includes(newText);
      
      if (!success) {
        // 重试不同的匹配策略
        // ...
      }
    }
    
    // 5. 写入文件
    writeFileSync(fullPath, newContent, "utf-8");
    
    return {
      content: [{ type: "text", text: `Edited ${path}` }],
      details: {
        path: fullPath,
        bytesChanged: newContent.length - fileContent.length,
        matchStart: matchResult.start,
        matchEnd: matchResult.end
      }
    };
  }
};

// 精确匹配算法
function findExactMatch(
  content: string,
  search: string
): { found: boolean; start: number; end: number } {
  const lines = content.split("\n");
  const searchLines = search.split("\n");
  const lineBreakIndex = content.indexOf("\n");
  
  let start = -1;
  let end = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = content.indexOf(line, start + 1);
    const lineEnd = lineStart + line.length;
    
    if (line === searchLines[0]) {
      // 匹配第一行
      for (let j = 1; j < searchLines.length; j++) {
        const nextLine = lines[i + j];
        const nextLineStart = lineEnd + lineBreakIndex + 1;
        const nextLineEnd = nextLineStart + nextLine.length;
        
        if (content.slice(nextLineStart, nextLineEnd) === searchLines[j]) {
          if (start === -1) start = lineStart;
          end = nextLineEnd;
        }
      }
      
      break;
    }
  }
  
  return {
    found: start !== -1,
    start,
    end
  };
}
```

### 4. Bash 工具

```typescript
const bashTool: AgentTool<BashInput, BashDetails> = {
  name: "bash",
  label: "Bash",
  description: "Execute shell commands with streaming output",
  
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
    timeout: Type.Optional(Type.Number({ 
      minimum: 1,
      description: "Timeout in seconds"
    }))
  }),
  
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const { command, cwd, timeout } = params;
    
    // 1. 超时控制
    const timeoutMs = timeout ? timeout * 1000 : 30000; // 默认 30 秒
    const controller = new AbortController();
    const combinedSignal = combineSignals([signal, controller.signal]);
    
    // 2. 执行命令
    try {
      const result = await spawnAsync(
        command,
        {
          cwd: cwd || ctx.cwd,
          timeout: timeoutMs,
          signal: combinedSignal
        },
        (chunk) => {
          // 流式输出
          onUpdate?.({
            content: [{ type: "text", text: chunk }],
            details: { isPartial: true }
          });
        }
      );
      
      // 3. 发送最终结果
      onUpdate?.({
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          command,
          cwd
        }
      });
      
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          command,
          cwd
        }
      };
    } catch (error) {
      if (error.name === "TimeoutError") {
        return {
          content: [{ type: "text", text: `Command timed out after ${timeoutMs}ms` }],
          isError: true,
          details: { error: "Timeout", command }
        };
      }
      
      throw error;
    }
  }
};
```

---

## 工具验证

### 运行时验证

```typescript
// 扩展可以通过 tool_call 事件拦截和验证
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    const { command } = event.input;
    
    // 1. 危险命令检测
    const dangerousCommands = [
      "rm -rf /",
      "mkfs.ext",
      ":(){:|:&};:|:};"
    ];
    
    for (const dangerous of dangerousCommands) {
      if (command.includes(dangerous)) {
        // 阻止执行
        return {
          block: true,
          reason: `Dangerous command detected: ${dangerous}`
        };
      }
    }
    
    // 2. 参数修改
    // 可以在执行前修改参数
    // 例如：强制添加 --dry-run 标志
  }
});

// 权限控制
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "write") {
    const { path } = event.input;
    
    // 1. 路径白名单检查
    const allowedPaths = ["/tmp", "/home/user/allowed"];
    const fullPath = resolvePath(path, ctx.cwd);
    
    if (!allowedPaths.some(allowed => fullPath.startsWith(allowed))) {
      return {
        block: true,
        reason: `Write operation not allowed outside allowed directories`
      };
    }
    
    // 2. 只允许特定扩展名
    const allowedExtensions = [".txt", ".md", ".json"];
    const ext = extname(path);
    
    if (!allowedExtensions.includes(ext)) {
      return {
        block: true,
        reason: `Only .txt, .md, .json files are allowed`
      };
    }
  }
});
```

---

## 自定义工具扩展

### 注册自定义工具

```typescript
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // 1. 注册部署工具
  pi.registerTool({
    name: "deploy_to_production",
    label: "Deploy to Production",
    description: "Deploy application to production servers with health check",
    
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
      skipHealthCheck: Type.Boolean({
        description: "Skip health check before deployment",
        default: false
      })
    }),
    
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { service, environment, skipHealthCheck } = params;
      
      // 1. 发送开始通知
      onUpdate?.({
        content: [{ type: "text", text: `Deploying ${service} to ${environment}...` }],
        details: { step: "starting" }
      });
      
      try {
        // 2. 健康检查
        if (!skipHealthCheck) {
          onUpdate?.({
            content: [{ type: "text", text: "Running health check..." }],
            details: { step: "health-check" }
          });
          
          const healthResult = await runHealthCheck(service, environment);
          
          if (!healthResult.healthy) {
            onUpdate?.({
              content: [{ type: "text", text: "Health check failed!" }],
              details: { healthResult },
              isError: true
            });
            
            return {
              content: [{ type: "text", text: "Deployment aborted due to health check failure" }],
              isError: true,
              details: { healthResult }
            };
          }
        }
        
        // 3. 构建镜像
        onUpdate?.({
          content: [{ type: "text", text: "Building Docker image..." }],
          details: { step: "build" }
        });
        
        const buildResult = await buildDockerImage(service);
        onUpdate?.({
          content: [{ type: "text", text: `Build complete: ${buildResult.imageId}` }],
          details: { buildResult }
        });
        
        // 4. 推送到生产环境
        onUpdate?.({
          content: [{ type: "text", text: "Deploying to production..." }],
          details: { step: "deploy" }
        });
        
        const deployResult = await deployToEnvironment(
          service,
          environment,
          buildResult.imageId
        );
        
        // 5. 部署成功
        onUpdate?.({
          content: [{ type: "text", text: `✓ Deployment successful! ID: ${deployResult.deploymentId}` }],
          details: { step: "complete", deployResult }
        });
        
        return {
          content: [{ type: "text", text: `Successfully deployed ${service} to ${environment}` }],
          details: {
            deploymentId: deployResult.deploymentId,
            imageId: buildResult.imageId,
            environment
          }
        };
      } catch (error) {
        // 6. 错误处理
        onUpdate?.({
          content: [{ type: "text", text: `❌ Deployment failed: ${error.message}` }],
          details: { error: error.message },
          isError: true
        });
        
        throw error;
      }
    }
  });
}
```

### 工具覆盖

```typescript
// 扩展可以覆盖内置工具的行为
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    // 完全替换 bash 工具执行
    const customResult = await myCustomBashExecutor(event.input);
    
    // 返回结果
    return {
      content: customResult.content,
      details: customResult.details
    };
  }
});
```

---

## 性能优化

### 1. 参数验证优化

```typescript
// 使用 AJV (Another JSON Schema Validator) 进行高性能验证
import Ajv from "ajv";

// 编译 TypeBox 模式为 JSON Schema
const compileSchema = (schema: TSchema): JSONSchemaType => {
  return TypeCompiler.Compile(schema, "JSON Schema");
};

// 验证工具参数时使用编译后的 schema
const jsonSchema = compileSchema(tool.parameters);
const ajv = new Ajv({ useDefaults: true });
const validate = ajv.compile(jsonSchema);

const isValid = validate(params);
```

### 2. 并行工具执行

```typescript
// 如果工具之间没有依赖关系，可以并行执行
async function executeToolsInParallel(
  toolCalls: LLMToolCall[],
  tools: Map<string, AgentTool>
): Promise<AgentToolResult[]> {
  const promises = toolCalls.map(async (toolCall) => {
    const tool = tools.get(toolCall.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool not found: ${toolCall.name}` }],
        isError: true
      };
    }
    
    const params = validateToolCall([tool], toolCall.params);
    if (!params.success) {
      return {
        content: [{ type: "text", text: `Validation errors: ${params.errors.join(", ")}` }],
        isError: true
      };
    }
    
    return tool.execute(
      toolCall.id,
      params.data,
      undefined,
      undefined,
      mockContext
    );
  });
  
  return Promise.all(promises);
}
```

### 3. 工具缓存

```typescript
// 缓存工具执行结果
const toolCache = new Map<string, Promise<AgentToolResult>>();

async function executeToolCached(
  toolName: string,
  params: Record<string, unknown>
): Promise<AgentToolResult> {
  const cacheKey = JSON.stringify({ toolName, params });
  
  // 1. 检查缓存
  if (toolCache.has(cacheKey)) {
    return toolCache.get(cacheKey)!;
  }
  
  // 2. 执行工具
  const result = await executeTool(toolName, params);
  
  // 3. 缓存结果
  toolCache.set(cacheKey, result);
  
  return result;
}

// 4. 缓存失效策略
function invalidateToolCache(toolName: string) {
  for (const key of toolCache.keys()) {
    const { toolName: tn } = JSON.parse(key);
    if (tn === toolName) {
      toolCache.delete(key);
    }
  }
}
```

---

## 核心优势

### 1. 类型安全
- 完整的 TypeScript 类型支持
- TypeBox 模式提供编译时验证
- 运行时参数验证

### 2. 灵活性
- 内置工具可被扩展覆盖
- 扩展可以注册自定义工具
- 工具执行完全可控

### 3. 流式支持
- onUpdate 回调实时更新 UI
- 支持长时间运行的任务
- 进度信息可追踪

### 4. 错误处理
- 详细的错误信息
- 工具级错误隔离
- 支持 isError 标记

### 5. 安全性
- 事件拦截：可阻止危险命令
- 权限检查：路径白名单、扩展名限制
- 验证失败作为错误返回

---

## 关键源码文件

- `packages/agent/src/types.ts` - AgentTool 接口定义
- `packages/ai/src/utils/validation.ts` - 验证逻辑
- `packages/coding-agent/src/core/tools/` - 所有内置工具
- `packages/coding-agent/src/core/tools/index.ts` - 工具注册表
- `packages/coding-agent/src/core/tools/read.ts` - Read 工具实现
- `packages/coding-agent/src/core/tools/write.ts` - Write 工具实现
- `packages/coding-agent/src/core/tools/edit.ts` - Edit 工具实现
- `packages/coding-agent/src/core/tools/bash.ts` - Bash 工具实现
- `packages/coding-agent/src/core/tools/grep.ts` - Grep 工具实现
- `packages/coding-agent/src/core/tools/find.ts` - Find 工具实现
- `packages/coding-agent/src/core/tools/ls.ts` - Ls 工具实现

---

**下一步**: 深度分析 #4 Agent 运行时
