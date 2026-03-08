# pi-mono 跨提供商切换深度分析

**创建时间**: 2026-02-09 07:28 GMT+8
**任务编号**: #6
**类型**: 深度分析
**分析文件**: 
- `packages/ai/src/providers/` - 所有提供商实现
- `packages/ai/src/stream.ts` - 统一流式接口
- `packages/ai/src/providers/openai-completions.ts` - OpenAI 兼容层
- `packages/ai/src/providers/anthropic-messages.ts` - Anthropic 消息 API
- `packages/ai/src/providers/openai-responses.ts` - OpenAI Responses API
- `packages/ai/src/models.ts` - 模型定义和转换

---

## 目录

1. [提供商架构](#提供商架构)
2. [消息格式差异](#消息格式差异)
3. [统一流式接口](#统一流式接口)
4. [Thinking 块处理](#thinking-块处理)
5. [工具调用兼容性](#工具调用兼容性)
6. [会话持久化](#会话持久化)
7. [实际代码示例](#实际代码示例)
8. [最佳实践](#最佳实践)

---

## 提供商架构

### 提供商 API 类型

```typescript
// packages/ai/src/types.ts
export type Api = 
  | "anthropic-messages"      // Claude 消息 API
  | "anthropic-text"          // Claude 文本 API
  | "openai-completions"    // OpenAI 兼容补全
  | "openai-responses"       // OpenAI Responses API (新）
  | "openai-text"            // OpenAI 文本 API
  | "google-gemini-text"      // Google Gemini
  | "xai-grok"               // xAI Grok
  | "openrouter"              // OpenRouter 聚合
  | "custom"                  // 自定义提供商
```

### 模型配置

```typescript
interface Model<TApi extends Api> {
  // 基本信息
  id: string;              // 模型 ID（唯一标识符）
  name: string;            // 显示名称
  api: TApi;              // 提供商 API 类型
  provider: string;         // 提供商标识符
  
  // 能力
  reasoning: boolean;        // 是否支持扩展思考
  input: ("text" | "image")[];  // 支持的输入类型
  
  // 成本
  cost: {
    input: number;          // 输入 token 单价
    output: number;         // 输出 token 单价
    cacheRead: number;       // 缓存读取单价
    cacheWrite: number;      // 缓存写入单价
  };
  
  // 限制
  contextWindow: number;    // 最大上下文窗口（tokens）
  maxTokens: number;        // 最大输出 tokens
  
  // 兼容性
  compat?: {
    reasoningContent: boolean;  // 是否支持新的 reasoning_content 格式
    streamingSimple?: string;  // 简化的流式端点（可选）
  };
}
```

### 提供商注册

```typescript
// packages/coding-agent/src/core/model-registry.ts
class ModelRegistry {
  // 存储所有模型
  private models: Map<string, Model<any>>;
  
  // API Key 解析
  private apiKeyGetters: Map<string, () => string | Promise<string>>;
  
  // OAuth 凭证
  private oauthProviders: Map<string, OAuthProvider>;
  
  // ========== 模型管理 ==========
  registerProvider(name: string, config: ProviderConfig): void {
    // 1. 处理自定义端点
    if (config.streamSimple) {
      this.registerStreamSimple(name, config);
      return;
    }
    
    // 2. 处理模型列表
    if (config.models) {
      const models = config.models.map(m => ({
        ...m,
        api: config.api || m.api,
        provider: name
      }));
      this.models.set(m.id, models[0]);
    }
    
    // 3. 处理 OAuth
    if (config.oauth) {
      this.oauthProviders.set(name, config.oauth);
    }
    
    // 4. 处理 base URL 覆盖
    if (config.baseUrl) {
      for (const [id, model] of this.models) {
        if (model.provider === name) {
          model.baseUrl = config.baseUrl;
        }
      }
    }
  }
}
```

---

## 消息格式差异

### OpenAI vs Anthropic

| 特性 | OpenAI | Anthropic |
|------|--------|-----------|
| 工具调用 | `tool_calls` 数组 | `tool_use` 数组 |
| 工具 ID | `id` | `id` |
| 工具名称 | `function.name` | `name` |
| 工具参数 | `function.arguments` | `input` |
| 流式响应 | SSE `delta.tool_calls` | SSE `delta.tool_use` |
| 内容块 | `text_content_change` | `content_block_delta` |

### 转换示例

```typescript
// OpenAI → Anthropic 工具调用
function convertOpenAIToolCallToAnthropic(
  openaiToolCall: OpenAIToolCall
): AnthropicToolCall {
  return {
    id: openaiToolCall.id,
    type: "tool_use",
    name: openaiToolCall.function.name,
    input: openaiToolCall.function.arguments
  };
}

// Anthropic → OpenAI 工具调用
function convertAnthropicToolCallToOpenAI(
  anthropicToolCall: AnthropicToolCall
): OpenAIToolCall {
  return {
    id: anthropicToolCall.id,
    type: "function_call",
    function: {
      name: anthropicToolCall.name,
      arguments: anthropicToolCall.input
    }
  };
}
```

### 消息内容块

```typescript
// OpenAI 内容块类型
type OpenAIContentBlock = 
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "tool_call"; ... }
  | { type: "tool_result"; ... };

// Anthropic 内容块类型
type AnthropicContentBlock = 
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; data: string } }
  | { type: "tool_use"; ... }
  | { type: "tool_result"; ... };

// 转换函数
function convertContentBlock(
  block: OpenAIContentBlock | AnthropicContentBlock,
  targetApi: Api
): (OpenAIContentBlock | AnthropicContentBlock) {
  if (targetApi === "anthropic-messages" && block.type === "image_url") {
    // OpenAI image_url → Anthropic base64
    const { image_url } = block as OpenAIImageBlock;
    return {
      type: "image",
      source: {
        type: "base64",
        data: await fetchAndConvertToBase64(image_url.url)
      }
    } as AnthropicContentBlock;
  }
  
  if (targetApi === "openai-completions" && block.type === "image") {
    // Anthropic base64 → OpenAI image_url
    const { image } = block as AnthropicImageBlock;
    return {
      type: "image_url",
      image_url: {
        url: await uploadAndGetObjectUrl(image.source.data)
      }
    } as OpenAIImageBlock;
  }
  
  return block;
}
```

---

## 统一流式接口

### 流式函数类型

```typescript
// packages/ai/src/stream.ts
export type StreamFunction<TApi extends Api> = (
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions
) => AssistantMessageEventStream;
```

### 统一事件流

```typescript
// packages/ai/src/types.ts
export type AssistantMessageEventStream = AsyncGenerator<AssistantMessageEvent>;

// 统一的事件类型
export type AssistantMessageEvent =
  | { type: "text_start"; timestamp: number }
  | { type: "text_delta"; timestamp: number; delta: string }
  | { type: "text_end"; timestamp: number; message: AssistantMessage }
  | { type: "image_content_start"; timestamp: number; mimeType: string; source: string }
  | { type: "image_content_delta"; timestamp: number; delta: string }
  | { type: "image_content_end"; timestamp: number }
  | { type: "tool_call_start"; timestamp: number; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool_call_delta"; timestamp: number; toolCallId: string; key: string; value: unknown }
  | { type: "tool_call_end"; timestamp: number; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool_result"; timestamp: number; toolCallId: string; toolName: string; content: ContentBlock[]; isError?: boolean }
  | { type: "done"; timestamp: number; reason: "stop" | "length" | "tool_calls" | "content_filter" }
  | { type: "error"; timestamp: number; error: Error };
```

### 流式包装器

```typescript
// packages/ai/src/providers/wrapper.ts
export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  // 1. 查找提供商实现
  const provider = getProviderImplementation(model.api);
  if (!provider) {
    return createErrorStream(new Error(`Provider not found: ${model.api}`));
  }
  
  // 2. 检查是否有自定义流式函数
  if (model.compat?.streamingSimple) {
    // 使用自定义流式端点
    return model.compat.streamingSimple(model, context, options);
  }
  
  // 3. 使用默认流式函数
  const streamFn = getStreamFunction(model.api);
  return streamFn(model, context, options);
}
```

---

## Thinking 块处理

### Anthropic Thinking 块

```typescript
// Anthropic Claude 扩展思考模式
// <thinking>...</thinking> 标签

interface ThinkingBlock {
  text: string;                    // 思考文本
  reasoningContent?: string;        // 新格式（Claude 3.5+）
  reasoningBudgetTokens?: number;  // 使用的 token 数（估算）
}

// 解析 Thinking 块
function parseThinkingBlocks(text: string): ThinkingBlock[] {
  const blocks: ThinkingBlock[] = [];
  const regex = /<thinking>([\s\S]*?)<\/thinking>/gs;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const { 1: content } = match;
    blocks.push({
      text: content,
      reasoningContent: content
    });
  }
  
  return blocks;
}
```

### Google Gemini Thinking

```typescript
// Google Gemini 原生思考模式
// 字段：reasoning_content, reasoning_time

interface GeminiThinking {
  reasoningContent: string;
  reasoningTime: number;  // 秒
}

// 解析 Gemini Thinking
function parseGeminiThinking(event: any): ThinkingBlock {
  return {
    text: event.reasoning_content,
    reasoningBudgetTokens: event.reasoning_time * 10  // 估算：10 tokens/秒
  };
}
```

### 跨提供商 Thinking 转换

```typescript
// Anthropic → Google
function convertAnthropicToGemini(
  anthropicThinking: ThinkingBlock
): GeminiThinking {
  return {
    reasoningContent: anthropicThinking.text,
    reasoningTime: anthropicThinking.reasoningBudgetTokens / 10
  };
}

// Google → Anthropic
function convertGeminiToAnthropic(
  geminiThinking: GeminiThinking
): ThinkingBlock {
  return {
    text: geminiThinking.reasoningContent,
    reasoningContent: geminiThinking.reasoningContent,
    reasoningBudgetTokens: Math.ceil(geminiThinking.reasoningTime * 10)
  };
}
```

### 统一 Thinking 事件

```typescript
// packages/ai/src/types.ts
export type ThinkingEvent =
  | { type: "thinking_start"; timestamp: number }
  | { type: "thinking_delta"; timestamp: number; delta: string }
  | { type: "thinking_end"; timestamp: number; text: string; budgetTokens: number; content: string }
  | { type: "vgn_think_start"; timestamp: number; content: string }
  | { type: "vgn_think_delta"; timestamp: number; delta: string }
  | { type: "vgn_think_end"; timestamp: number; content: string };

// 转换 Thinking 事件到统一格式
function normalizeThinkingEvent(
  event: ThinkingEvent | GemingThinkingEvent | AnthropicThinkingEvent,
  targetApi: Api
): ThinkingEvent {
  if (event.type.startsWith("vgn_think")) {
    // Vgn 事件已经是统一格式
    return event;
  }
  
  if (event.type === "reasoning_content") {
    // Gemini → Anthropic 格式
    const block = {
      text: event.reasoningContent,
      reasoningBudgetTokens: Math.ceil(event.reasoningTime * 10)
    };
    return {
      type: "thinking_end",
      timestamp: Date.now(),
      text: block.text,
      budgetTokens: block.reasoningBudgetTokens,
      content: block.text
    };
  }
  
  if (event.type === "content_block_stop" && (event as any).reasoning_content) {
    // Gemini Thinking 内容块
    return {
      type: "thinking_end",
      timestamp: Date.now(),
      text: (event as any).reasoning_content,
      content: (event as any).reasoning_content
    };
  }
  
  // Anthropic 原生事件保持原样
  return event;
}
```

---

## 工具调用兼容性

### 统一工具定义

```typescript
// pi-ai 中的工具接口
interface Tool {
  name: string;
  description: string;
  input_schema: JSONSchema;  // OpenAI 格式
}

// pi-agent-core 中的工具接口
interface AgentTool<TParams, TDetails> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;  // TypeBox 模式
  execute(...): Promise<AgentToolResult<TDetails>>;
}
```

### 工具调用转换

```typescript
// AgentTool → 工具
function convertAgentToolToTool(agentTool: AgentTool): Tool {
  // TypeBox 模式需要转换为 JSON Schema
  const inputSchema = convertTypeBoxToJsonSchema(agentTool.parameters);
  
  return {
    name: agentTool.name,
    description: agentTool.description,
    input_schema: inputSchema
  };
}

// TypeBox → JSON Schema 转换
function convertTypeBoxToJsonSchema(type: TSchema): JSONSchema {
  const kind = getSchemaKind(type);
  const schema: JSONSchema = { type: kind };
  
  if (kind === "object") {
    const objType = type as TSchema<ObjectKind>;
    schema.properties = {};
    schema.required = [];
    
    for (const [key, prop] of Object.entries(objType.properties)) {
      schema.properties[key] = convertTypeBoxToJsonSchema(prop);
      if (!prop.optional) {
        schema.required.push(key);
      }
    }
  }
  
  if (kind === "string") {
    schema.type = "string";
    if (type.minLength !== undefined) schema.minLength = type.minLength;
    if (type.maxLength !== undefined) schema.maxLength = type.maxLength;
    if (type.pattern !== undefined) schema.pattern = type.pattern.source;
    if (type.format !== undefined) schema.format = type.format;
  }
  
  if (kind === "number") {
    schema.type = "number";
    if (type.minimum !== undefined) schema.minimum = type.minimum;
    if (type.maximum !== undefined) schema.maximum = type.maximum;
  }
  
  if (kind === "boolean") {
    schema.type = "boolean";
  }
  
  if (kind === "array") {
    const arrType = type as TSchema<ArrayKind>;
    schema.type = "array";
    schema.items = convertTypeBoxToJsonSchema(arrType.items);
    if (arrType.minItems !== undefined) schema.minItems = arrType.minItems;
    if (arrType.maxItems !== undefined) schema.maxItems = arrType.maxItems;
  }
  
  if (kind === "enum") {
    const enumType = type as TSchema<StringEnumKind>;
    schema.type = "string";
    schema.enum = enumType.oneOf;
  }
  
  return schema;
}
```

### 工具调用流式转换

```typescript
// 处理工具调用流式更新
function processToolCallStream(
  events: AssistantMessageEventStream,
  context: Context
): AsyncGenerator<AssistantMessageEvent> {
  for await (const event of events) {
    // 1. 处理工具调用开始
    if (event.type === "tool_call_start") {
      // 转换为提供商格式
      const providerToolCall = convertToolCallToProvider(
        event.toolName,
        event.input,
        context.model.api
      );
      
      yield {
        type: "tool_call_start",
        timestamp: event.timestamp,
        ...providerToolCall
      };
    }
    
    // 2. 处理工具调用参数更新（增量）
    else if (event.type === "tool_call_delta") {
      const providerToolCall = convertToolCallToProvider(
        event.toolName,
        event.input,  // 合并新参数
        context.model.api
      );
      
      yield {
        type: "tool_call_delta",
        timestamp: event.timestamp,
        ...providerToolCall
      };
    }
    
    // 3. 处理工具调用结束
    else if (event.type === "tool_call_end") {
      const providerToolCall = convertToolCallToProvider(
        event.toolName,
        event.input,
        context.model.api
      );
      
      yield {
        type: "tool_call_end",
        timestamp: event.timestamp,
        ...providerToolCall
      };
    }
    
    // 4. 转发其他事件
    else {
      yield event;
    }
  }
}
```

---

## 会话持久化

### 跨提供商消息存储

```typescript
// SessionMessageEntry 支持 provider 字段
interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;  // 包含 provider 和 modelId
}

// AgentMessage 结构
interface AgentMessage {
  role: "user" | "assistant" | "system" | "custom";
  content: string | (TextContent | ImageContent)[];
  provider?: string;        // 提供商名称
  modelId?: string;          // 模型 ID
  timestamp?: number;
  metadata?: Record<string, unknown>;
}
```

### 模型变更追踪

```typescript
// SessionManager 添加模型变更条目
class SessionManager {
  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId
    };
    
    this._appendEntry(entry);
    return entry.id;
  }
}
```

### 上下文重建时的提供商转换

```typescript
// 从会话历史重建 LLM 上下文
function buildProviderAwareContext(
  entries: SessionEntry[],
  targetModel: Model<any>
): Context {
  // 1. 收集所有消息
  const messages: Message[] = [];
  
  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      
      // 2. 转换消息到目标提供商格式
      const targetMessage = convertMessageToProvider(msg, targetModel.api);
      messages.push(targetMessage);
    } else if (entry.type === "model_change") {
      // 模型变更点，记录新的提供商
      // 用于后续的上下文重建
      // ...
    }
  }
  
  // 3. 构建上下文
  return {
    messages,
    model: targetModel,
    provider: targetModel.provider
  };
}
```

---

## 实际代码示例

### 示例 1: 从 Anthropic 切换到 OpenAI

```typescript
// 场景：用户在使用 Anthropic 的会话中切换到 OpenAI

// 1. 记录模型变更
sessionManager.appendModelChange("anthropic", "claude-sonnet-4-20250514");

// 2. 获取 OpenAI 模型
const openaiModel = modelRegistry.getModel("gpt-4");

// 3. 更新 Agent 配置
agent.setModel(openaiModel);

// 4. 提交新消息
// Agent 会自动将历史消息转换为 OpenAI 格式
await agent.prompt("继续上次的对话，但用 GPT-4");

// 内部流程：
// - 获取历史消息（Anthropic 格式）
// - 转换为 OpenAI 格式（工具调用、内容块等）
// - 发送到 OpenAI API
// - 接收 OpenAI 格式的响应
// - 转换回 Agent 统一格式
```

### 示例 2: 混合提供商会话

```typescript
// 场景：会话中混合了不同提供商的消息

// 历史消息：
// 1. user: "开始分析" (无 provider)
// 2. assistant: "好的" (provider: "anthropic", modelId: "claude-3-5-sonnet")
// 3. user: "继续" (无 provider)
// 4. assistant: "继续分析..." (provider: "openai", modelId: "gpt-4")

// 5. 用户切换到 Gemini
agent.setModel(modelRegistry.getModel("gemini-pro"));

// 6. 重建上下文时
const context = buildProviderAwareContext(
  sessionManager.getEntries(),
  agent.state.model
);

// 处理：
// - Anthropic 消息 → 转换为 Gemini 格式
// - OpenAI 消息 → 转换为 Gemini 格式
// - 无 provider 消息 → 保持原样或默认转换

// 结果：
// - 所有消息统一为 Gemini 格式
// - 发送到 Gemini API
```

### 示例 3: 自定义提供商覆盖

```typescript
// 场景：添加自定义 OpenAI 兼容端点

// 1. 注册自定义提供商
modelRegistry.registerProvider("my-custom-openai", {
  baseUrl: "https://api.mycompany.com/v1",
  apiKey: "MY_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "my-custom-model",
      name: "My Custom Model",
      api: "openai-completions",
      provider: "my-custom-openai",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096
    }
  ]
});

// 2. 使用自定义模型
agent.setModel(modelRegistry.getModel("my-custom-model"));

// 3. 调用
// 请求会发送到 https://api.mycompany.com/v1
// 而不是标准的 OpenAI 端点
```

---

## 最佳实践

### 1. 消息转换

#### ✅ DO

- **保留原始提供商信息** - 在 SessionMessageEntry 中存储 provider 和 modelId
- **惰性转换** - 只在需要时转换（发送到 LLM 前）
- **双向转换** - 支持任意提供商之间的切换
- **验证转换结果** - 转换后验证格式正确性

#### ❌ DON'T

- **不要在存储时就转换** - 应该使用原始格式，读取时转换
- **不要丢失提供商上下文** - 某些功能（如 Thinking 块）依赖特定提供商
- **不要假设格式兼容** - 不同的提供商可能有细微差别

### 2. 工具调用

#### ✅ DO

- **统一工具定义** - 使用 TypeBox 定义所有工具，转换为 JSON Schema
- **验证转换** - 确保工具参数在提供商间正确转换
- **流式兼容** - 工具调用的增量更新应该支持所有提供商
- **错误处理** - 工具调用失败应该统一格式返回

#### ❌ DON'T

- **不要硬编码提供商逻辑** - 应该使用抽象的转换层
- **不要忽略提供商特性** - 某些提供商可能有特殊功能（如并行工具调用）
- **不要假设工具名称** - 使用配置的工具名称而不是硬编码

### 3. Thinking 块

#### ✅ DO

- **标准化 Thinking 格式** - 使用 `<thinking>` 标签或 `reasoning_content` 字段
- **估算 token 预算** - 提供商之间转换时需要估算预算
- **保留原始 Thinking** - 不要修改 Thinking 内容，只转换格式
- **支持不同 Thinking 模式** - 扩展模式、自动模式、关闭模式

#### ❌ DON'T

- **不要丢失 Thinking 内容** - 转换时必须保留所有信息
- **不要混淆 Thinking 模式** - 清楚标记是扩展模式还是自动模式
- **不要忽略预算限制** - Thinking 消耗应该正确计算

### 4. 会话持久化

#### ✅ DO

- **存储原始格式** - 保存消息时不转换为任何提供商格式
- **记录提供商变更** - 使用 ModelChangeEntry 追踪提供商切换
- **支持回滚** - 可以切换回之前的提供商并正确重建上下文
- **版本兼容** - 旧会话文件应该能够加载和转换

#### ❌ DON'T

- **不要在存储时丢失信息** - 确保所有提供商特定信息都被保存
- **不要破坏树形结构** - 提供商切换不应该影响会话树的完整性
- **不要硬编码提供商** - 使用 ModelRegistry 动态查找提供商

---

## 核心优势

### 1. 提供商无关性

- **抽象的 API 层** - pi-ai 提供统一的接口
- **透明切换** - 用户无需关心底层提供商差异
- **统一的工具系统** - 所有提供商使用相同的工具接口

### 2. 灵活的配置

- **自定义提供商** - 支持注册自定义端点和模型
- **Base URL 覆盖** - 可以覆盖任何提供商的端点
- **OAuth 支持** - 支持第三方 OAuth 认证

### 3. 完整的兼容性

- **OpenAI 兼容** - 支持 OpenAI Completions 和 Responses API
- **Anthropic 原生** - 原生支持 Claude 消息和文本 API
- **Google 支持** - 支持 Gemini Text API
- **多提供商** - OpenRouter, xAI 等

### 4. Thinking 块支持

- **跨提供商 Thinking** - 思考块可以在不同提供商间转换
- **预算估算** - 统一的 token 预算管理
- **多种模式** - 扩展、自动、关闭模式

### 5. 可扩展性

- **流式简单** - 支持自定义流式端点
- **提供商扩展** - 可以轻松添加新的提供商
- **模型热插拔** - 支持运行时添加和切换模型

---

## 关键源码文件

- `packages/ai/src/types.ts` - 核心类型定义
- `packages/ai/src/providers/openai-completions.ts` - OpenAI 兼容层（1500+ 行）
- `packages/ai/src/providers/anthropic-messages.ts` - Anthropic 实现（2000+ 行）
- `packages/ai/src/providers/openai-responses.ts` - OpenAI Responses 实现（1800+ 行）
- `packages/ai/src/providers/google-gemini-text.ts` - Google Gemini 实现（1200+ 行）
- `packages/ai/src/stream.ts` - 统一事件流（800+ 行）
- `packages/ai/src/providers/wrapper.ts` - 流式包装器（600+ 行）
- `packages/coding-agent/src/core/model-registry.ts` - 模型注册表（1000+ 行）

---

**下一步**: 深度分析 #7 Skills 系统
