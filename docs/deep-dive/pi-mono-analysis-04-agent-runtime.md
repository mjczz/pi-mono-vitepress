# pi-mono Agent 运行时快速扫描

**创建时间**: 2026-02-09 06:25 GMT+8
**任务编号**: #4
**类型**: 快速扫描概览

---

## 核心组件

### 1. Agent 类（pi-agent-core）

```typescript
class Agent {
  // 状态
  state: AgentState;

  // 配置
  config: AgentConfig;

  // 方法
  prompt(text: string | AgentMessage, ...): Promise<void>;
  continue(): Promise<void>;
  abort(): void;
  reset(): void;
  waitForIdle(): Promise<void>;

  // 事件
  subscribe(callback: (event: AgentEvent) => void): () => void;
}
```

**AgentState**：
```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  isStreaming: boolean;
  streamMessage: AgentMessage | null;
  pendingToolCalls: Set<string>;
  error?: string;
}
```

### 2. AgentLoop（pi-agent-core）

```typescript
// 低级别 Agent 循环
async function* agentLoop(
  initialMessages: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent>
```

**事件流**：
```
agent_start
├─ message_start (user)
├─ message_end
├─ message_start (assistant)
│  ├─ message_update (streaming)
│  ├─ message_update
│  └─ message_end
├─ turn_start
├─ turn_end
├─ message_start (user)
├─ turn_end
└─ agent_end
```

### 3. AgentContext 和 AgentLoopConfig

```typescript
interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}

interface AgentLoopConfig {
  model: Model<any>;
  convertToLlm: (messages: AgentMessage[]) => Message[];
  transformContext?: (messages: AgentMessage[]) => AgentMessage[];
  steeringMode?: "one-at-a-time" | "all";
  followUpMode?: "one-at-a-time" | "all";
  streamFn?: StreamFunction;
  sessionId?: string;
  getApiKey?: (provider: string) => string | Promise<string>;
  thinkingBudgets?: Record<string, number>;
}
```

---

## 消息流

### 流式更新机制

```typescript
// 订阅事件
agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      console.log("Agent 开始工作");
      break;

    case "message_start":
      if (event.assistantMessageEvent) {
        console.log("开始流式生成");
      }
      break;

    case "message_update":
      // 实时更新 UI
      const delta = event.assistantMessageEvent.delta;
      updateUI(delta);
      break;

    case "message_end":
      // 消息完整
      break;

    case "tool_call":
      console.log("工具调用:", event.toolCallId);
      break;

    case "turn_end":
      console.log("一轮完成");
      break;

    case "agent_end":
      console.log("Agent 完成");
      break;
  }
});
```

**事件类型**：
- `agent_start` - Agent 开始
- `agent_end` - Agent 结束
- `turn_start` - 新一轮开始
- `turn_end` - 一轮结束
- `message_start` - 消息开始
- `message_update` - 消息更新（流式）
- `message_end` - 消息结束
- `tool_call` - 工具调用
- `tool_result` - 工具结果

---

## Steering 和 Follow-up

### Steering 消息队列

```typescript
// 打断当前工作
agent.steer({
  role: "user",
  content: "Stop! Do this instead.",
  timestamp: Date.now()
});
```

**机制**：
1. 用户按 Enter，排队 steering 消息
2. 等待当前工具完成后立即投递
3. 取消剩余工具
4. 触发新 turn

**配置**：
```typescript
steeringMode: "one-at-a-time" | "all";
```

### Follow-up 消息队列

```typescript
// 排队在所有工作完成后
agent.followUp({
  role: "user",
  content: "Also summarize the result.",
  timestamp: Date.now()
});
```

**机制**：
1. 用户按 Alt+Enter，排队 follow-up 消息
2. 等待 Agent 完全空闲后投递
3. 所有工具和消息都完成后触发

**配置**：
```typescript
followUpMode: "one-at-a-time" | "all";
```

---

## Abort 机制

```typescript
// 取消当前操作
agent.abort();

// 等待空闲
await agent.waitForIdle();
```

**实现**：
```typescript
class Agent {
  private abortController: AbortController;

  abort(): void {
    // 1. 取消所有工具调用
    for (const call of this.state.pendingToolCalls) {
      this.abortController.abort(call);
    }
    this.state.pendingToolCalls.clear();

    // 2. 设置错误状态
    this.state.error = "User aborted";

    // 3. 通知流
    this.notifySubscribers({ type: "error", ... });
  }
}
```

---

## 状态管理

### Agent 状态

```typescript
interface AgentState {
  systemPrompt: string;        // 系统提示词
  model: Model<any>;            // 当前模型
  thinkingLevel: ThinkingLevel; // 思考级别
  tools: AgentTool<any>[];      // 可用工具
  messages: AgentMessage[];      // 消息历史
  isStreaming: boolean;         // 是否在流式传输
  streamMessage: AgentMessage | null; // 当前流式消息
  pendingToolCalls: Set<string>; // 等待中的工具调用
  error?: string;               // 错误信息
}
```

### 状态修改方法

```typescript
agent.setSystemPrompt("You are helpful.");
agent.setModel(getModel("anthropic", "claude-sonnet-4-20250514"));
agent.setThinkingLevel("medium");
agent.setTools([tool1, tool2]);
agent.replaceMessages(newMessages);
```

---

## 工具调用集成

### 工具执行循环

```typescript
// 在 AgentLoop 中
for await (const toolCall of toolCalls) {
  // 1. 触发 tool_call 事件
  await emitToolCall(toolCall);

  // 2. 执行工具
  const result = await tool.execute(
    toolCall.params,
    abortSignal,
    (update) => {
      // 3. 流式更新
      emitToolResult(toolCall.id, update);
    }
  );

  // 4. 触发 tool_result 事件
  await emitToolResult(toolCall.id, result);

  // 5. 添加到上下文
  context.messages.push(createToolResultMessage(result));
}
```

### 扩展集成

```typescript
// 扩展可以注册自定义工具
pi.registerTool({
  name: "my_tool",
  ...,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 工具逻辑
  }
});
```

---

## 核心优势

### 1. 事件驱动架构
- 清晰的事件流
- 易于理解和调试
- 支持多个订阅者

### 2. 流式支持
- 实时消息更新
- 流式工具结果
- 节省 token（可以提前中断）

### 3. 消息队列
- Steering: 打断当前工作
- Follow-up: 排队后续任务
- 灵活的控制模式

### 4. Abort 支持
- 随时取消工具调用
- 取消流式响应
- 清理资源

### 5. 类型安全
- 完整的 TypeScript 类型系统
- 工具参数验证

---

## 关键源码文件

- `packages/agent/src/agent.ts` - Agent 类（300+ 行）
- `packages/agent/src/agent-loop.ts` - Agent 循环实现（500+ 行）
- `packages/agent/src/types.ts` - 类型定义

---

**下一步**: 深度分析会话管理（树形算法、压缩策略、UI 实现）
