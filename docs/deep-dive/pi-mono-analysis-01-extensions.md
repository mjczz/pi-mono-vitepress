# pi-mono Extensions 系统深度分析

**创建时间**: 2026-02-08 23:15 GMT+8
**任务编号**: #1
**状态**: ✅ 已完成

---

## 目录

1. [核心设计理念](#核心设计理念)
2. [ExtensionAPI 架构](#extensionapi-架构)
3. [扩展生命周期](#扩展生命周期)
4. [事件系统](#事件系统)
5. [工具注册](#工具注册)
6. [命令和快捷键](#命令和快捷键)
7. [UI 交互](#ui-交互)
8. [加载机制](#加载机制)
9. [实际示例](#实际示例)
10. [最佳实践](#最佳实践)

---

## 核心设计理念

pi 的 Extensions 系统遵循"极简核心，极致扩展"的原则：

### 设计原则

1. **运行时注入** - 扩展在加载时获得完整的 ExtensionAPI
2. **事件驱动** - 通过订阅生命周期事件来响应系统状态变化
3. **类型安全** - 使用 TypeScript 类型系统确保扩展正确性
4. **权限控制** - 扩展无法直接修改内部状态，必须通过 API
5. **沙箱隔离** - 扩展模块独立加载，错误不影响主程序

### 核心能力

扩展可以做：

- ✅ 订阅代理生命周期事件
- ✅ 注册 LLM 可调用的工具
- ✅ 注册斜杠命令
- ✅ 注册键盘快捷键
- ✅ 注册 CLI 标志
- ✅ 提供自定义 UI 组件
- ✅ 修改消息渲染
- ✅ 拦截和修改用户输入
- ✅ 注册新的 LLM 提供商

---

## ExtensionAPI 架构

### API 分组

ExtensionAPI 被分为以下几个逻辑组：

#### 1. 事件订阅 (Event Subscription)

```typescript
export interface ExtensionAPI {
  // 订阅各种事件
  on(event: string, handler: ExtensionHandler): void;

  // 主要事件类型：
  on(event: "session_start", handler: ...): void;
  on(event: "agent_start", handler: ...): void;
  on(event: "tool_call", handler: ...): void;
  on(event: "input", handler: ...): void;
  // ... 更多事件
}
```

#### 2. 工具注册 (Tool Registration)

```typescript
registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(
  tool: ToolDefinition<TParams, TDetails>
): void;
```

**ToolDefinition 结构**:

```typescript
interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  name: string;                      // 工具名称（LLM 调用时使用）
  label: string;                     // 人类可读的标签
  description: string;                 // LLM 工具描述
  parameters: TParams;                 // TypeBox 参数模式

  // 执行函数
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult<TDetails>>;

  // 自定义渲染
  renderCall?: (args: Static<TParams>, theme: Theme) => Component;
  renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component;
}
```

#### 3. 命令、快捷键、标志注册

```typescript
// 注册斜杠命令
registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void;

interface RegisteredCommand {
  name: string;
  description?: string;
  getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

// 注册键盘快捷键
registerShortcut(shortcut: KeyId, options: {
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
}): void;

// 注册 CLI 标志
registerFlag(name: string, options: {
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
}): void;
```

#### 4. 消息和会话操作

```typescript
// 发送自定义消息
sendMessage<T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): void;

// 发送用户消息（总是触发 turn）
sendUserMessage(
  content: string | (TextContent | ImageContent)[],
  options?: { deliverAs?: "steer" | "followUp" }
): void;

// 追加自定义条目（不发送到 LLM）
appendEntry<T = unknown>(customType: string, data?: T): void;

// 会话元数据
setSessionName(name: string): void;
getSessionName(): string | undefined;
setLabel(entryId: string, label: string | undefined): void;
```

#### 5. UI 交互

```typescript
// ExtensionContext.ui 提供完整的 UI 能力
interface ExtensionUIContext {
  // 对话框
  select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;

  // 通知和状态
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;

  // 组件
  setWidget(key: string, content: string[] | Component | undefined, options?: ExtensionWidgetOptions): void;
  setFooter(factory: ((tui, theme, footerData) => Component) | undefined): void;
  setHeader(factory: ((tui, theme) => Component) | undefined): void;
  setEditorComponent(factory: ((tui, theme, keybindings) => EditorComponent) | undefined): void;

  // 自定义组件（带焦点）
  custom<T>(factory: (tui, theme, keybindings, done: (result: T) => void) => Component | Promise<Component>, options?: {
    overlay?: boolean;
    overlayOptions?: OverlayOptions | (() => OverlayOptions);
    onHandle?: (handle: OverlayHandle) => void;
  }): Promise<T>;

  // 编辑器控制
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;

  // 主题
  readonly theme: Theme;
  getAllThemes(): { name: string; path: string | undefined }[];
  getTheme(name: string): Theme | undefined;
  setTheme(theme: string | Theme): { success: boolean; error?: string };

  // 工具输出
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}
```

#### 6. 模型和思考级别

```typescript
// 设置当前模型
setModel(model: Model<any>): Promise<boolean>;

// 获取/设置思考级别
getThinkingLevel(): ThinkingLevel;
setThinkingLevel(level: ThinkingLevel): void;

// 注册提供商
registerProvider(name: string, config: ProviderConfig): void;
```

#### 7. 工具和命令查询

```typescript
// 工具
getActiveTools(): string[];
getAllTools(): ToolInfo[];
setActiveTools(toolNames: string[]): void;

// 命令
getCommands(): SlashCommandInfo[];

// 标志值
getFlag(name: string): boolean | string | undefined;
```

---

## 扩展生命周期

### 1. 加载阶段

```typescript
// 扩展文件结构
export default function (pi: ExtensionAPI): void | Promise<void> {
  // 在这里注册所有内容
  pi.on("session_start", async (event, ctx) => { ... });
  pi.registerTool({ ... });
  pi.registerCommand("my-cmd", { ... });
}
```

**加载流程**:

```
1. discoverAndLoadExtensions()
   ↓
2. 从目录发现扩展
   - ~/.pi/agent/extensions/
   - .pi/extensions/
   - 命令行指定路径
   ↓
3. 使用 jiti 动态加载扩展模块
   ↓
4. 创建 ExtensionAPI 实例
   ↓
5. 调用扩展工厂函数 (export default)
   ↓
6. 扩展注册工具、命令、事件处理器等
   ↓
7. 返回 LoadExtensionsResult (包含扩展列表 + 运行时)
```

### 2. 初始化阶段

```typescript
// runner.bindCore(actions, contextActions)
// 将真实的动作实现注入到运行时
```

**绑定阶段**:

```typescript
bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void {
  // 复制动作到共享运行时（所有扩展 API 都引用这个）
  this.runtime.sendMessage = actions.sendMessage;
  this.runtime.sendUserMessage = actions.sendUserMessage;
  this.runtime.appendEntry = actions.appendEntry;
  this.runtime.setSessionName = actions.setSessionName;
  // ... 更多动作

  // 处理在扩展加载期间排队的提供商注册
  for (const { name, config } of this.runtime.pendingProviderRegistrations) {
    this.modelRegistry.registerProvider(name, config);
  }
  this.runtime.pendingProviderRegistrations = [];
}
```

### 3. 运行阶段

扩展在以下时候被触发：

- 事件发生（session_start, agent_start 等）
- 用户调用命令
- 用户按下快捷键
- LLM 调用工具
- 其他扩展通过事件总线通信

### 4. 清理阶段

```typescript
// session_shutdown 事件
pi.on("session_shutdown", async (_event, ctx) => {
  // 清理资源
  // 保存状态
});
```

---

## 事件系统

### 事件类型树

```
ExtensionEvent
├── ResourcesDiscoverEvent      # 资源发现
├── SessionEvent              # 会话生命周期
│   ├── SessionStartEvent
│   ├── SessionBeforeSwitchEvent
│   ├── SessionSwitchEvent
│   ├── SessionBeforeForkEvent
│   ├── SessionForkEvent
│   ├── SessionBeforeCompactEvent
│   ├── SessionCompactEvent
│   ├── SessionShutdownEvent
│   ├── SessionBeforeTreeEvent
│   └── SessionTreeEvent
├── ContextEvent              # 上下文修改
├── BeforeAgentStartEvent     # Agent 启动前
├── AgentEvent                # Agent 生命周期
│   ├── AgentStartEvent
│   └── AgentEndEvent
├── TurnEvent                 # 轮次
│   ├── TurnStartEvent
│   └── TurnEndEvent
├── ModelSelectEvent          # 模型选择
├── UserBashEvent            # 用户 bash 命令
├── InputEvent               # 用户输入
├── ToolCallEvent            # 工具调用（可阻塞）
│   ├── BashToolCallEvent
│   ├── ReadToolCallEvent
│   ├── EditToolCallEvent
│   ├── WriteToolCallEvent
│   ├── GrepToolCallEvent
│   ├── FindToolCallEvent
│   ├── LsToolCallEvent
│   └── CustomToolCallEvent
└── ToolResultEvent           # 工具结果（可修改）
```

### 事件结果类型

不同的事件可以返回不同的结果：

| 事件 | 结果类型 | 用途 |
|------|---------|------|
| `context` | `{ messages?: AgentMessage[] }` | 修改发送到 LLM 的消息 |
| `before_agent_start` | `{ message?: CustomMessage; systemPrompt?: string }` | 注入消息或修改系统提示 |
| `tool_call` | `{ block?: boolean; reason?: string }` | 阻止工具执行 |
| `tool_result` | `{ content?, details?, isError? }` | 修改工具结果 |
| `user_bash` | `{ operations?: BashOperations; result?: BashResult }` | 自定义 bash 执行或结果 |
| `session_before_switch` | `{ cancel?: boolean }` | 取消会话切换 |
| `session_before_fork` | `{ cancel?: boolean; skipConversationRestore?: boolean }` | 取消 forking |
| `session_before_compact` | `{ cancel?: boolean; compaction?: CompactionResult }` | 阻止或自定义压缩 |
| `session_before_tree` | `{ cancel?, summary?, customInstructions?, replaceInstructions?, label? }` | 阻止或自定义树导航 |

### 事件示例

```typescript
// 1. 修改发送到 LLM 的上下文
pi.on("context", async (event, ctx) => {
  // 过滤掉某些敏感信息
  const filteredMessages = event.messages.filter(msg => {
    // 不发送系统通知给 LLM
    if (msg.customType === "internal") return false;
    return true;
  });

  return { messages: filteredMessages };
});

// 2. 在 Agent 启动前注入系统消息
pi.on("before_agent_start", async (event, ctx) => {
  if (event.prompt.toLowerCase().includes("security")) {
    // 添加特殊的安全提示
    return {
      message: {
        customType: "security-warning",
        content: "Security analysis mode enabled",
        display: true
      },
      systemPrompt: `${ctx.getSystemPrompt()}\n\nSECURITY MODE ON`
    };
  }
});

// 3. 阻止危险工具调用
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command.includes("rm -rf")) {
    return {
      block: true,
      reason: "Dangerous command blocked by extension"
    };
  }
});

// 4. 修改工具结果
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName === "grep") {
    // 格式化 grep 输出
    const formatted = formatGrepOutput(event.content);
    return {
      content: [{ type: "text", text: formatted }],
      isError: false
    };
  }
});

// 5. 会话关闭时保存状态
pi.on("session_shutdown", async (_event, ctx) => {
  const state = {
    lastSessionId: ctx.sessionManager.getCurrentSession()?.id,
    timestamp: Date.now()
  };
  await fs.writeFile("~/.pi/extension-state.json", JSON.stringify(state));
});
```

---

## 工具注册

### 工具定义完整示例

```typescript
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "deploy_to_production",
    label: "Deploy to Production",
    description: "Deploy the current application to production servers",
    parameters: Type.Object({
      service: Type.String({
        description: "Service name (e.g., web-api, worker)",
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
      }),
      rollbackOnError: Type.Boolean({
        description: "Auto rollback on deployment failure",
        default: true
      })
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // 1. 执行前通知
      ctx.ui.notify(`Deploying ${params.service} to ${params.environment}...`, "info");

      try {
        // 2. 流式更新进度
        onUpdate?.({
          content: [{ type: "text", text: "Running tests..." }],
          details: { step: "tests", progress: 0 }
        });

        if (!params.skipTests) {
          await runTests(params.service, signal);
        }

        onUpdate?.({
          content: [{ type: "text", text: "Building Docker image..." }],
          details: { step: "build", progress: 25 }
        });

        await buildDockerImage(params.service, signal);

        // 3. 实际部署
        const deploymentId = await deploy(params, signal, (progress) => {
          onUpdate?.({
            content: [{ type: "text", text: `Deploying... ${progress}%` }],
            details: { step: "deploy", progress }
          });
        });

        // 4. 返回结果
        return {
          content: [{
            type: "text",
            text: `Deployment successful! ID: ${deploymentId}`
          }],
          details: {
            service: params.service,
            environment: params.environment,
            deploymentId,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        // 5. 错误处理
        if (params.rollbackOnError) {
          await rollback(params.service);
          ctx.ui.notify("Rolled back due to error", "warning");
        }

        throw new Error(`Deployment failed: ${error.message}`);
      }
    },

    // 自定义工具调用渲染
    renderCall(args, theme) {
      return html`
        <div class="border ${theme.border} p-2 rounded">
          <div class="font-bold ${theme.primary}">Deploy ${args.service}</div>
          <div class="text-sm text-gray-500">
            Target: ${args.environment} |
            Tests: ${args.skipTests ? '❌' : '✅'} |
            Rollback: ${args.rollbackOnError ? '✅' : '❌'}
          </div>
        </div>
      `;
    },

    // 自定义结果渲染
    renderResult(result, options, theme) {
      const { deploymentId, timestamp } = result.details ?? {};
      return html`
        <div class="p-2 bg-green-900 text-green-100 rounded">
          <div class="font-bold">✓ Deployment Successful</div>
          <div class="text-sm mt-1">
            ID: ${deploymentId}<br/>
            Time: ${new Date(timestamp).toLocaleString()}
          </div>
        </div>
      `;
    }
  });
}
```

### TypeBox 参数模式

```typescript
import { Type, StringEnum } from "@sinclair/typebox";

// 基本类型
Type.String({ description: "A string value" });
Type.Number({ description: "A number", minimum: 0 });
Type.Boolean({ description: "A boolean flag" });

// 可选参数
Type.Optional(Type.String({ description: "Optional string" }));

// 带默认值
Type.String({ description: "Name", default: "unknown" });

// 枚举
StringEnum(["red", "green", "blue"], { default: "blue" });

// 数组
Type.Array(Type.String(), { minItems: 1, maxItems: 10 });

// 对象
Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Number({ minimum: 0, maximum: 150 }),
  tags: Type.Array(StringEnum(["tag1", "tag2", "tag3"]))
});

// 嵌套对象
Type.Object({
  user: Type.Object({
    name: Type.String(),
    email: Type.String({ format: "email" })
  }),
  settings: Type.Object({
    notifications: Type.Boolean({ default: true }),
    theme: StringEnum(["light", "dark"], { default: "light" })
  })
});
```

### 工具执行最佳实践

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  // 1. 检查 abort signal
  if (signal?.aborted) {
    throw new Error("Operation cancelled");
  }

  // 2. 参数验证（TypeBox 自动验证，但可额外检查）
  if (!params.name || params.name.trim() === "") {
    throw new Error("Name cannot be empty");
  }

  // 3. 流式更新（长时间操作）
  onUpdate?.({
    content: [{ type: "text", text: "Initializing..." }],
    details: { stage: "init" }
  });

  await step1(params, signal);
  if (signal?.aborted) throw new Error("Cancelled");

  onUpdate?.({
    content: [{ type: "text", text: "Processing..." }],
    details: { stage: "process", progress: 50 }
  });

  await step2(params, signal);

  // 4. 返回标准格式
  return {
    content: [{ type: "text", text: "Operation complete" }],
    details: { /* 任意元数据 */ }
  };
}
```

---

## 命令和快捷键

### 注册命令

```typescript
pi.registerCommand("analyze", {
  description: "Analyze current project",
  getArgumentCompletions: (prefix) => {
    // 提供自动完成
    const options = ["code", "deps", "security", "performance"];
    const filtered = options.filter(o => o.startsWith(prefix));
    return filtered.length > 0
      ? filtered.map(o => ({ value: o, label: o }))
      : null;
  },

  async handler(args, ctx) {
    // args 是命令后的参数字符串
    const mode = args.trim() as "code" | "deps" | "security" | "performance";

    // 使用 UI 交互
    ctx.ui.notify(`Running ${mode} analysis...`, "info");

    // 执行命令逻辑
    const result = await analyzeProject(mode, ctx.cwd);

    // 显示结果
    const showDetails = await ctx.ui.confirm(
      "Analysis Complete",
      `Found ${result.issues.length} issues. View details?`
    );

    if (showDetails) {
      await ctx.ui.custom(async (tui, theme, done) => {
        // 自定义 UI 组件
        return new AnalysisResultComponent(result, done);
      });
    }
  }
});
```

### 注册快捷键

```typescript
import type { KeyId } from "@mariozechner/pi-tui";

pi.registerShortcut("ctrl+shift+d", {
  description: "Deploy current project",
  async handler(ctx) {
    // 快捷键处理器
    if (!ctx.isIdle()) {
      ctx.ui.notify("Agent is busy, please wait", "warning");
      return;
    }

    await ctx.ui.select("Deploy to", ["production", "staging", "dev"]);
  }
});
```

**保留的快捷键**（扩展不能覆盖）：

```typescript
const RESERVED_ACTIONS = [
  "interrupt",
  "clear",
  "exit",
  "suspend",
  "cycleThinkingLevel",
  "cycleModelForward",
  "cycleModelBackward",
  "selectModel",
  "expandTools",
  "toggleThinking",
  "externalEditor",
  "followUp",
  "submit",
  "selectConfirm",
  "selectCancel",
  "copy",
  "deleteToLineEnd",
];
```

### 注册 CLI 标志

```typescript
pi.registerFlag("auto-deploy", {
  description: "Auto deploy on successful tests",
  type: "boolean",
  default: false
});

pi.registerFlag("deployment-target", {
  description: "Target deployment environment",
  type: "string",
  default: "production"
});

// 读取标志值
const autoDeploy = pi.getFlag("auto-deploy") as boolean;
const target = pi.getFlag("deployment-target") as string;
```

---

## UI 交互

### 基本对话框

```typescript
// 选择对话框
const choice = await ctx.ui.select(
  "Select Action",
  ["Deploy", "Rollback", "View Logs"]
);

// 确认对话框
const confirmed = await ctx.ui.confirm(
  "Dangerous Operation",
  "Are you sure you want to delete all data?",
  { timeout: 10000 }  // 10 秒超时
);

// 输入对话框
const input = await ctx.ui.input(
  "Enter your name",
  "John Doe",
  { timeout: 30000 }
);
```

### 通知和状态

```typescript
// 通知
ctx.ui.notify("Operation started", "info");
ctx.ui.notify("Warning: deprecated API", "warning");
ctx.ui.notify("Error: connection failed", "error");

// 状态栏
ctx.ui.setStatus("deploy", "Deploying... 75%");
// ... 操作完成
ctx.ui.setStatus("deploy", undefined);  // 清除状态

// 工作消息（在流式输出时显示）
ctx.ui.setWorkingMessage("Analyzing code...");
// ... 完成后恢复
ctx.ui.setWorkingMessage();
```

### 自定义组件

```typescript
// 简单组件（文本数组）
ctx.ui.setWidget("status", [
  "Deployment in progress",
  "Target: production",
  "Estimated time: 2 min"
], { placement: "aboveEditor" });

// 清除组件
ctx.ui.setWidget("status", undefined);

// 自定义组件（工厂函数）
ctx.ui.setWidget("deployment-status", (tui, theme) => {
  return new DeploymentStatusComponent(tui, theme);
}, { placement: "aboveEditor" });
```

### 自定义页脚/页眉

```typescript
// 自定义页脚
ctx.ui.setFooter((tui, theme, footerData) => {
  return new CustomFooterComponent(tui, theme, footerData);
});

// 自定义页眉（启动时显示）
ctx.ui.setHeader((tui, theme) => {
  return new CustomHeaderComponent(tui, theme);
});
```

### 自定义编辑器

```typescript
// 完整自定义编辑器（例如 Vim 模式）
import { CustomEditor } from "@mariozechner/pi-coding-agent";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "normal";

  handleInput(data: string): void {
    if (this.mode === "normal") {
      // 处理 Vim normal mode 键
      if (data === "i") {
        this.mode = "insert";
        return;
      }
      if (data === ":q") {
        // 退出命令
        return;
      }
    } else {
      // Insert mode - 调用父类处理编辑
      super.handleInput(data);
    }
  }
}

ctx.ui.setEditorComponent((tui, theme, keybindings) => {
  return new VimEditor(tui, theme, keybindings);
});
```

### 全屏自定义组件

```typescript
const result = await ctx.ui.custom<string>(async (tui, theme, keybindings, done) => {
  return new CustomInteractiveComponent(tui, theme, keybindings, done);
}, {
  overlay: true,
  overlayOptions: {
    width: "80%",
    height: "70%"
  },
  onHandle: (handle) => {
    // 动态控制覆盖层
    // handle.show() / handle.hide()
  }
});
```

---

## 加载机制

### jiti 加载器

pi 使用 `@mariozechner/jiti` fork 动态加载 TypeScript 扩展：

```typescript
const jiti = createJiti(import.meta.url, {
  moduleCache: false,  // 不缓存，每次重新加载
  ...(isBunBinary
    ? { virtualModules: VIRTUAL_MODULES, tryNative: false }
    : { alias: getAliases() }
});

const module = await jiti.import(extensionPath, { default: true });
const factory = module as ExtensionFactory;
```

### 发现规则

**优先级顺序**：

1. **全局扩展**: `~/.pi/agent/extensions/`
2. **项目扩展**: `cwd/.pi/extensions/`
3. **命令行指定**: `pi -e ./my-ext.ts`

**目录发现规则**：

```
extensions/
├── single-file.ts           # 直接文件 → 加载
├── multi-file/              # 子目录 → 检查 index.ts
│   └── index.ts
├── package-based/            # 带 package.json → 检查 pi 字段
│   ├── package.json         # { "pi": { "extensions": ["./ext1.ts"] } }
│   └── ext1.ts
└── index.ts                # 目录入口 → 加载
```

### package.json manifest

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/deploy.ts", "./extensions/monitor.ts"],
    "skills": ["./skills/deploy-guide.md"],
    "prompts": ["./prompts/review.md"],
    "themes": ["./themes/dark-blue.json"]
  }
}
```

### 加载流程

```typescript
export async function discoverAndLoadExtensions(
  configuredPaths: string[],
  cwd: string,
  agentDir: string = getAgentDir(),
  eventBus?: EventBus
): Promise<LoadExtensionsResult> {
  const allPaths: string[] = [];
  const seen = new Set<string>();

  // 1. 全局扩展
  const globalExtDir = path.join(agentDir, "extensions");
  addPaths(discoverExtensionsInDir(globalExtDir));

  // 2. 项目扩展
  const localExtDir = path.join(cwd, ".pi", "extensions");
  addPaths(discoverExtensionsInDir(localExtDir));

  // 3. 显式配置路径
  for (const p of configuredPaths) {
    const resolved = resolvePath(p, cwd);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      // 检查 package.json manifest 或 index.ts
      const entries = resolveExtensionEntries(resolved);
      if (entries) {
        addPaths(entries);
        continue;
      }
      // 发现单个文件
      addPaths(discoverExtensionsInDir(resolved));
      continue;
    }

    addPaths([resolved]);
  }

  // 4. 加载所有扩展
  return loadExtensions(allPaths, cwd, eventBus);
}
```

---

## 实际示例

### 示例 1: 文件触发器扩展

```typescript
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const triggerFile = "/tmp/agent-trigger.txt";

    // 监听文件变化
    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          // 发送消息到 agent
          pi.sendMessage(
            {
              customType: "file-trigger",
              content: `External trigger: ${content}`,
              display: true,
            },
            { triggerTurn: true }
          );
          // 清空文件
          fs.writeFileSync(triggerFile, "");
        }
      } catch {
        // 文件可能不存在
      }
    });

    if (ctx.hasUI) {
      ctx.ui.notify(`Watching ${triggerFile}`, "info");
    }
  });
}
```

### 示例 2: 命令列表扩展

```typescript
import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";

export default function commandsExtension(pi: ExtensionAPI) {
  pi.registerCommand("commands", {
    description: "List available slash commands",

    getArgumentCompletions: (prefix) => {
      const sources = ["extension", "prompt", "skill"];
      const filtered = sources.filter((s) => s.startsWith(prefix));
      return filtered.length > 0
        ? filtered.map((s) => ({ value: s, label: s }))
        : null;
    },

    async handler(args, ctx) {
      const commands = pi.getCommands();
      const sourceFilter = args.trim() as "extension" | "prompt" | "skill" | "";

      const filtered = sourceFilter
        ? commands.filter((c) => c.source === sourceFilter)
        : commands;

      if (filtered.length === 0) {
        ctx.ui.notify(sourceFilter ? `No ${sourceFilter} commands found` : "No commands found", "info");
        return;
      }

      // 构建选择项
      const items: string[] = [];
      for (const source of ["extension", "prompt", "skill"]) {
        const cmds = filtered.filter((c) => c.source === source);
        if (cmds.length > 0) {
          items.push(`--- ${source} ---`);
          items.push(...cmds.map(c => `/${c.name} - ${c.description || ""}`));
        }
      }

      // 显示选择器
      const selected = await ctx.ui.select("Available Commands", items);

      if (selected && !selected.startsWith("---")) {
        const cmdName = selected.split(" - ")[0].slice(1);
        const cmd = commands.find((c) => c.name === cmdName);
        if (cmd?.path) {
          const showPath = await ctx.ui.confirm(cmd.name, `View source path?\n${cmd.path}`);
          if (showPath) {
            ctx.ui.notify(cmd.path, "info");
          }
        }
      }
    }
  });
}
```

### 示例 3: Git 集成扩展

```typescript
import { exec } from "child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function gitExtension(pi: ExtensionAPI) {
  // 注册 Git 工具
  pi.registerTool({
    name: "git_status",
    label: "Git Status",
    description: "Check git repository status",
    parameters: {
      repoPath: { type: "string", description: "Repository path" }
    },

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = execSync(`git status`, {
        cwd: params.repoPath,
        encoding: "utf-8"
      });

      return {
        content: [{ type: "text", text: result.stdout }],
        details: { repo: params.repoPath }
      };
    }
  });

  // 注册提交命令
  pi.registerCommand("commit", {
    description: "Create a git commit",
    async handler(args, ctx) {
      const message = await ctx.ui.input("Commit message", "Update code");

      if (!message) {
        ctx.ui.notify("Commit cancelled", "info");
        return;
      }

      ctx.ui.setWorkingMessage("Committing...");

      try {
        execSync(`git add -A`, { cwd: ctx.cwd });
        execSync(`git commit -m "${message}"`, { cwd: ctx.cwd });

        ctx.ui.notify(`Committed: ${message}`, "info");
      } catch (error) {
        ctx.ui.notify(`Commit failed: ${error.message}`, "error");
      } finally {
        ctx.ui.setWorkingMessage();
      }
    }
  });

  // 在 Agent 完成后自动提交
  pi.on("agent_end", async (event, ctx) => {
    const lastMessage = event.messages[event.messages.length - 1];

    // 检查是否有文件修改
    const { filesModified } = await checkGitStatus(ctx.cwd);

    if (filesModified > 0) {
      const shouldCommit = await ctx.ui.confirm(
        "Auto-commit",
        `${filesModified} files modified. Commit changes?`
      );

      if (shouldCommit) {
        await ctx.ui.input("Commit message", `AI: ${lastMessage.content}`);
      }
    }
  });
}
```

---

## 最佳实践

### 1. 错误处理

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      await initializeExtension(ctx);
    } catch (error) {
      // 不要让扩展错误崩溃整个系统
      ctx.ui.notify(`Extension error: ${error.message}`, "error");
      ctx.appendEntry("extension-error", {
        name: "my-extension",
        error: error.message,
        stack: error.stack
      });
    }
  });
}
```

### 2. 资源清理

```typescript
let watcher: fs.FSWatcher | null = null;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    watcher = fs.watchFile(someFile, (curr, prev) => {
      // 处理文件变化
    });
  });

  pi.on("session_shutdown", async () => {
    // 清理资源
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  });
}
```

### 3. 避免竞态条件

```typescript
let isProcessing = false;

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (isProcessing) {
      ctx.ui.notify("Please wait, operation in progress", "warning");
      return;
    }

    isProcessing = true;
    try {
      await processInput(event.text, ctx);
    } finally {
      isProcessing = false;
    }
  });
}
```

### 4. 类型安全的事件处理

```typescript
import { isBashToolResult, isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // 类型守卫
    if (isToolCallEventType("bash", event)) {
      event.input.command;  // TypeScript 知道这是 string
    }

    if (isToolCallEventType("my_tool", event)) {
      event.input.customField;  // 类型安全
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    // 类型守卫
    if (isBashToolResult(event)) {
      event.details.exitCode;  // TypeScript 知道这是 number | undefined
    }
  });
}
```

### 5. 渐进式 UI

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerCommand("deploy", {
    description: "Deploy application",

    async handler(_args, ctx) {
      // 1. 简单确认
      const confirmed = await ctx.ui.confirm(
        "Deploy",
        "Deploy to production?"
      );
      if (!confirmed) return;

      // 2. 显示进度
      ctx.ui.setWorkingMessage("Preparing deployment...");

      // 3. 显示状态栏
      ctx.ui.setStatus("deploy", "Building...");

      // 4. 完成后通知
      ctx.ui.notify("Deployment complete!", "info");

      // 5. 清理
      ctx.ui.setWorkingMessage();
      ctx.ui.setStatus("deploy", undefined);
    }
  });
}
```

---

## 总结

pi 的 Extensions 系统是一个设计精良的扩展框架：

### 优点

1. **类型安全** - 完整的 TypeScript 类型系统
2. **事件驱动** - 解耦扩展和核心逻辑
3. **强大的 UI 能力** - 完整的自定义 UI 组件支持
4. **灵活的工具系统** - 流式更新、自定义渲染
5. **清晰的 API** - 分组良好、文档完整

### 扩展能力

- ✅ 生命周期事件订阅
- ✅ 工具注册和自定义
- ✅ 命令、快捷键、CLI 标志
- ✅ 自定义 UI 组件
- ✅ 消息拦截和修改
- ✅ 会话控制
- ✅ 模型提供商注册

### 适用场景

- 添加特定领域的工具（部署、数据库、API）
- 自定义工作流（测试、代码审查、文档生成）
- 集成外部系统（Git、Jira、监控）
- 创建自定义 UI（仪表盘、可视化、交互式工具）

---

**相关文件**:
- `packages/coding-agent/src/core/extensions/types.ts` - 完整类型定义
- `packages/coding-agent/src/core/extensions/loader.ts` - 加载机制
- `packages/coding-agent/src/core/extensions/runner.ts` - 事件运行时
- `packages/coding-agent/examples/extensions/` - 扩展示例

**下一步**: 分析 #2 会话管理
