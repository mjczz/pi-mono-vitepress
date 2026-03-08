# pi-mono 跨提供商切换快速扫描

**创建时间**: 2026-02-09 06:35 GMT+8
**任务编号**: #6
**类型**: 快速扫描概览

---

## 核心概念

### 1. 跨提供商场景

```typescript
// 场景示例
// 1. 从 OpenAI 切换到 Anthropic
OpenAI: [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi from GPT-4", provider: "openai", model: "gpt-4" }
]
↓ (上下文转换)
Anthropic: [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi from GPT-4" },  // 保留原始文本
  { role: "assistant", content: "Hello from Claude", provider: "anthropic", model: "claude-3-5" }
]

// 2. 从 Anthropic 切换到 Google（带 Thinking）
Anthropic with thinking: [
  { role: "assistant", content: "Let me think...", thinking: ["<thinking>...", "</thinking>"] }
]
↓ (Thinking 块转换)
Google: [
  { role: "user", content: "Continue" },
  { role: "assistant", content: "Let me think...", thinking: { content: "...", reasoningContent: "...", reasoningTime: 5 } }
]
```

### 2. 消息格式差异

| 特性 | OpenAI | Anthropic | Google |
|------|--------|----------|--------|
| 工具调用 | `tool_calls` | `tool_use` | `function_calls` |
| Thinking | 不支持 | 不支持 | `reasoningContent` 字段 |
| 流式 | SSE | SSE | SSE |

### 3. 转换规则

```typescript
// pi-ai 中的统一转换
// 工具调用
OpenAI `tool_calls` → Anthropic `tool_use`
OpenAI `tool_calls` → Google `function_calls`

// Thinking 块
Anthropic `<thinking>` tags → Google `reasoningContent` 对象
Google `reasoningContent` → Anthropic `<thinking>` tags（反向支持）

// 消息角色
OpenAI `system` → Anthropic `system` → Google `system`
OpenAI `user` → Anthropic `user` → Google `user`
OpenAI `assistant` → Anthropic `assistant` → Google `model`（assistant 别名）
```

---

## 实现细节

### 1. 上下文重建

```typescript
// 从 AgentMessage[] 重建 Context
function rebuildContextForProvider(
  messages: AgentMessage[],
  targetProvider: string,
  targetModel: Model<any>
): Context {
  const convertedMessages = messages.map(msg => {
    // 1. 转换工具调用格式
    const convertedContent = convertToolCalls(msg.content, targetProvider);

    // 2. 转换 Thinking 块格式
    const convertedContentWithThinking = convertThinkingBlocks(convertedContent, targetProvider);

    return {
      ...msg,
      content: convertedContentWithThinking
    };
  });

  return {
    messages: convertedMessages,
    systemPrompt: getSystemPromptForProvider(targetProvider, targetModel),
    model: targetModel
  };
}
```

### 2. 工具调用转换

```typescript
// OpenAI 工具调用 → Anthropic 工具调用
function convertToolCallsToAnthropic(content: ContentBlock[]): ContentBlock[] {
  return content.map(block => {
    if (block.type === "toolCall") {
      const tc = block as ToolCallBlock;
      return {
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.arguments  // Anthropic 用 input
      } as ContentBlock;
    }
    return block;
  });
}

// OpenAI 工具调用 → Google 工具调用
function convertToolCallsToGoogle(content: ContentBlock[]): ContentBlock[] {
  return content.map(block => {
    if (block.type === "toolCall") {
      const tc = block as ToolCallBlock;
      return {
        type: "function_calls",
        functionCall: {
          id: tc.id,
          name: tc.name,
          args: tc.arguments  // Google 用 args
        }
      } as ContentBlock;
    }
    return block;
  });
}
```

### 3. Thinking 块转换

```typescript
// Anthropic Thinking → Google Thinking
function convertThinkingToGoogle(
  thinking: ThinkingBlock[]
): ContentBlock[] {
  return thinking.map(t => {
    if (t.type === "thinking") {
      return {
        type: "thinking",
        thinking: {
          content: t.text,
          reasoningContent: t.text,  // Google 格式
          reasoningTime: 1  // 计算的 token 数
        }
      } as ContentBlock;
    }
    return t;
  });
}

// Google Thinking → Anthropic Thinking
function convertThinkingToAnthropic(
  thinking: ThinkingBlock[]
): ContentBlock[] {
  return thinking.map(t => {
    if (t.type === "thinking") {
      return {
        type: "thinking",
        thinking: {
          text: `<thinking>${t.text}</thinking>`,  // Anthropic 格式
          reasoningBudgetTokens: 1  // 估算的 token 数
        }
      } as ContentBlock;
    }
    return t;
  });
}
```

### 4. 会话持久化

```typescript
// SessionEntry 存储跨提供商兼容的消息
interface SessionMessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: {
    // 存储原始 ContentBlock[]
    content: ContentBlock[];
    // 存储提供商信息
    provider?: string;
    modelId?: string;
  };
}

// 加载时重建上下文
const sessionManager = new SessionManager(sessionFile);
const context = sessionManager.buildSessionContext();

// context.messages 自动转换为 AgentMessage[]
// provider 信息从 model_change 条目获取
```

---

## 实际使用

### 场景 1：不同模型间切换

```bash
# 用户操作
/model  # 选择模型
# 选择 Anthropic Claude 3.5 Sonnet
```

```typescript
// 内部流程
function switchModel(newModel: Model<any>) {
  const oldModel = agentState.model;
  const oldProvider = oldModel?.api;
  const newProvider = newModel.api;

  // 1. 触发 model_select 事件
  emit({
    type: "model_select",
    model: newModel,
    previousModel: oldModel,
    source: "set"  // 或 "cycle"
  });

  // 2. 转换上下文（如果需要）
  if (oldProvider !== newProvider) {
    const convertedContext = convertContext(
      agentState.messages,
      newProvider,
      newModel
    );
    agentState.messages = convertedContext.messages;
  }

  // 3. 更新状态
  agentState.model = newModel;

  // 4. 保存会话状态
  sessionManager.appendModelChange(newProvider, newModel.id);
}
```

### 场景 2：跨提供商恢复会话

```typescript
// 会话保存了跨提供商消息
// 加载时自动转换到当前提供商

// 示例：会话中混合了 OpenAI 和 Anthropic 的消息
// 加载时如果当前模型是 Google，转换所有消息为 Google 格式

function loadSession(sessionFile: string) {
  const entries = loadSessionEntries(sessionFile);
  const currentModel = getCurrentModel();  // 从设置中获取

  // 构建上下文（pi-ai 自动处理转换）
  const context = buildSessionContext(entries, currentModel.id);

  // context.messages 已经是 AgentMessage[] 格式
  // 原始 ContentBlock 已根据当前提供商转换

  agentState.messages = context.messages;
  agentState.model = currentModel;
  agentState.thinkingLevel = context.thinkingLevel;
}
```

---

## 限制和边界

### 1. Thinking 兼容性

| 提供商 | Thinking 格式 | 跨提供商支持 |
|--------|------------|------------|
| Anthropic | `<thinking>` tags | ✅ 部分支持（需要手动转换） |
| Google | `reasoningContent` 对象 | ✅ 完全支持 |
| OpenAI | 不支持 | ❌ 无需转换 |
| xAI | `reasoning_content` 字段 | ⚠️  实验性支持 |

### 2. 工具调用格式

| 提供商 | 工具格式 | 转换复杂度 |
|--------|---------|------------|
| OpenAI | `tool_calls` | 标准 |
| Anthropic | `tool_use` | 简单 |
| Google | `function_calls` | 中等 |
| xAI | `tool_calls` | 标准 |

### 3. 会话大小限制

```typescript
// 大会话文件中的跨提供商消息
// 需要在加载时转换，可能消耗大量 CPU

// 建议：分批加载或使用增量转换
```

---

## 核心优势

### 1. 透明切换
- 用户无需关心提供商差异
- 消息历史自动转换
- 模型切换无缝衔接

### 2. 智能转换
- 自动处理格式差异
- 保留关键信息（工具调用 ID、参数）
- 支持 Thinking 块转换

### 3. 向后兼容
- 会话文件格式保持稳定
- 旧会话可以正常加载
- 提供商独立演进

### 4. 会话持久化
- 跨提供商消息统一存储
- 加载时自动适配当前提供商
- 支持实验性功能

---

## 关键源码文件

- `packages/ai/src/providers/` - 各提供商实现
- `packages/ai/src/providers/openai-completions.ts` - OpenAI 转换
- `packages/ai/src/providers/anthropic-messages.ts` - Anthropic 转换
- `packages/ai/src/providers/openai-responses.ts` - OpenAI Responses 转换
- `packages/ai/src/stream.ts` - 统一转换逻辑
- `packages/ai/src/models.ts` - 模型注册表

---

**下一步**: Skills 系统（Agent Skills 标准、SKILL.md 格式、加载机制）
