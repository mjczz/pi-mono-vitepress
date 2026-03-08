# pi-mono Agent 运行时深度分析

**创建时间**: 2026-02-09 06:52 GMT+8
**任务编号**: #4
**类型**: 深度分析
**分析文件**: 
- `packages/agent/src/agent.ts` - Agent 类实现
- `packages/agent/src/agent-loop.ts` - Agent 循环实现
- `packages/agent/src/types.ts` - 核心类型定义

---

## 目录

1. [Agent 类架构](#agent-类架构)
2. [Agent 循环实现](#agent-循环实现)
3. [消息流机制](#消息流机制)
4. [事件系统](#事件系统)
5. [状态管理](#状态管理)
6. [Steering 和 Follow-up](#steering-和-follow-up)
7. [Abort 机制](#abort-机制)
8. [工具执行集成](#工具执行集成)
9. [流式更新](#流式更新)

---

## Agent 类架构

### 类结构

```typescript
export class Agent {
  // ========== 状态 ==========
  private state: AgentState;
  private stateListeners: Set<AgentStateListener>;
  
  // ========== 配置 ==========
  readonly config: AgentConfig;
  
  // ========== 工具 ==========
  private toolMap: Map<string, AgentTool<any>>;
  private pendingToolCalls: Map<string, PendingToolCall>;
  private activeToolCall?: ActiveToolCall;
  
  // ========== 事件 ==========
  private eventEmitters: Map<string, EventEmitter<any>>;
  
  // ========== 控制 ==========
  private abortController: AbortController;
  private abortReason?: string;
}
```

### AgentState

```typescript
interface AgentState {
  // 配置
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  
  // 消息
  messages: AgentMessage[];
  
  // 执行状态
  isStreaming: boolean;
  isAborting: boolean;
  isIdle: boolean;
  
  // 错误
  error?: string;
  
  // 流式消息
  streamMessage?: AgentMessage;
  
  // 待处理
  pendingSteering: AgentMessage[];     // 用户打断消息
  pendingFollowUps: AgentMessage[];    // 队列的后续消息
}
```

### AgentConfig

```typescript
interface AgentConfig {
  systemPrompt: string;
  model: Model<any>;
  tools: AgentTool<any>[];
  
  // 流式配置
  streamFn?: StreamFunction;
  
  // 转换函数
  transformContext?: (messages: AgentMessage[]) => AgentMessage[];
  
  // 配置选项
  steeringMode?: "one-at-a-time" | "all";
  followUpMode?: "one-at-a-time" | "all";
  
  // 会话 ID
  sessionId?: string;
  
  // 思考预算
  thinkingBudgets?: Record<string, number>;
  
  // API Key 获取
  getApiKey?: (provider: string) => string | Promise<string>;
}
```

---

## Agent 循环实现

### 核心循环

```typescript
// packages/agent/src/agent-loop.ts
export async function* agentLoop(
  initialMessages: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent>
{
  const { model, convertToLlm, streamFn, getApiKey } = config;
  const apiKey = await getApiKey(model.api, model.provider);
  
  // 1. 转换消息为 LLM 格式
  const llmMessages = convertToLlm(context.messages);
  
  // 2. 设置思考预算
  const thinkingBudgets = config.thinkingBudgets 
    ? getThinkingBudgets(config.thinkingBudgets, model)
    : undefined;
  
  // 3. 开始流式调用
  const stream = streamFn(model, {
    messages: llmMessages,
    systemPrompt: context.systemPrompt,
    tools: convertToLlmTools(context.tools),
    thinkingBudget: thinkingBudgets
  }, { apiKey });
  
  // 4. 发出 agent_start 事件
  yield { type: "agent_start" };
  
  // 5. 流式响应循环
  for await (const event of stream) {
    // 处理不同事件类型
    if (event.type === "text_start") {
      yield { type: "message_start", ... };
    } else if (event.type === "text_delta") {
      yield { type: "message_update", delta: event.delta, ... };
    } else if (event.type === "text_end") {
      yield { type: "message_end", message: event.message, ... };
      
      // 处理工具调用
      const toolCalls = extractToolCalls(event.message.content);
      for (const toolCall of toolCalls) {
        yield { type: "tool_call", ...toolCall, ... };
        
        // 执行工具并返回结果
        const toolResult = await executeTool(toolCall, config);
        yield { type: "tool_result", ...toolResult, ... };
        
        // 添加工具结果到上下文
        context.messages.push(createToolResultMessage(toolResult));
      }
      
      // 检查是否完成
      if (isComplete(event.message)) {
        yield { type: "turn_end", ... };
        break;
      }
    } else if (event.type === "tool_call") {
      // 工具调用事件
      yield event;
    } else if (event.type === "done") {
      // 流结束
      yield event;
      break;
    }
  }
}
```

### 事件流协议

```typescript
// 流式事件类型
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; reason: string }
  | { type: "turn_start"; turnIndex: number; timestamp: number }
  | { type: "turn_end"; turnIndex: number; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; timestamp: number }
  | { type: "message_update"; timestamp: number; delta: string }
  | { type: "message_end"; timestamp: number; message: AgentMessage }
  | { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; toolName: string; content: ContentBlock[]; isError?: boolean }
  | { type: "done"; reason: string }
  | { type: "error"; error: Error };
  | { type: "text_start"; timestamp: number }
  | { type: "text_delta"; timestamp: number; delta: string }
  | { type: "text_end"; timestamp: number; message: Message };
  | { type: "vgn_start"; timestamp: number; content: string }
  | { type: "vgn_delta"; timestamp: number; delta: string }
  | { type: "vgn_end"; timestamp: number; content: string };
  | { type: "reasoning_content_start"; timestamp: number; content: string }
  | { type: "reasoning_content_delta"; timestamp: number; delta: string }
  | { type: "reasoning_content_end"; timestamp: number; content: string };
  | { type: "vgn_think_start"; timestamp: number; content: string }
  | { type: "vgn_think_delta"; timestamp: number; delta: string }
  | { type: "vgn_think_end"; timestamp: number; content: string };
```

---

## 消息流机制

### 流式消息处理

```typescript
// packages/agent/src/agent.ts

class Agent {
  private async processStream(): Promise<void> {
    this.state.isStreaming = true;
    this.state.streamMessage = {
      role: "assistant",
      content: [],
      timestamp: Date.now()
    };
    
    // 1. 发出 message_start 事件
    this.emit("message_start", { timestamp: Date.now() });
    
    try {
      // 2. 开始 Agent 循环
      for await (const event of this.runAgentLoop()) {
        // 3. 处理流式更新
        if (event.type === "message_update") {
          this.handleStreamUpdate(event);
        } else if (event.type === "tool_call") {
          this.handleToolCall(event);
        } else if (event.type === "tool_result") {
          this.handleToolResult(event);
        } else if (event.type === "turn_end") {
          this.handleTurnEnd(event);
        }
      }
      
      // 4. 检查 abort
      if (this.state.isAborting) {
        throw new AgentAbortedError(this.abortReason);
      }
    }
    } catch (error) {
      // 5. 错误处理
      this.state.error = error.message;
      this.emit("error", { error });
    } finally {
      // 6. 清理状态
      this.state.isStreaming = false;
      this.state.streamMessage = undefined;
      this.emit("agent_end", { reason: "complete" });
    }
  }
}
```

### 流式更新处理

```typescript
private handleStreamUpdate(event: MessageUpdateEvent): void {
  const { delta, timestamp } = event;
  
  // 1. 获取当前流式消息
  const message = this.state.streamMessage!;
  const content = message.content;
  
  // 2. 根据事件类型更新
  if (event.type === "text_delta") {
    // 文本内容
    const textBlock = content.findLast((b): b is TextContent => b);
    if (textBlock && textBlock.type === "text") {
      textBlock.text += delta;
    }
  } else if (event.type === "image_content_start") {
    // 图片内容
    content.push({ type: "image", data: event.data, mimeType: event.mimeType });
  } else if (event.type === "tool_call_start") {
    // 工具调用
    content.push({ type: "toolCall", id: event.id, name: event.name, input: event.input });
  } else if (event.type === "tool_call_delta") {
    // 工具参数更新
    const toolCall = content.findLast((b): b is ToolCallContent => b.id === event.id)!;
    if (toolCall) {
      if (!toolCall.input) toolCall.input = {};
      toolCall.input[event.key] = event.value;
    }
  }
  
  // 3. 更新时间戳
  message.timestamp = timestamp;
  
  // 4. 发出更新事件
  this.emit("message_update", { delta, timestamp });
}
```

### 流式结束处理

```typescript
private handleStreamEnd(event: MessageEndEvent): void {
  const { message } = event;
  
  // 1. 检查是否包含工具调用
  const toolCalls = extractToolCalls(message.content);
  
  if (toolCalls.length > 0) {
    // 2. 触发工具调用
    for (const toolCall of toolCalls) {
      this.emit("tool_call", {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.input
      });
    }
  } else {
    // 3. 纯文本消息，直接完成
    this.state.messages.push(message);
    this.emit("message_end", { message });
  }
}
```

---

## 事件系统

### 事件发射

```typescript
class Agent {
  private eventEmitters: Map<string, EventEmitter<any>>;
  
  // ========== 公共方法 ==========
  
  // 订阅事件
  subscribe(callback: (event: AgentEvent) => void): () => void {
    const emitter = new EventEmitter<AgentEvent>();
    const listener = (event: AgentEvent) => callback(event);
    
    emitter.on(listener);
    
    // 返回取消订阅函数
    return () => emitter.off(listener);
  }
  
  // 发出事件
  private emit<T>(eventName: string, data: T): void {
    const emitter = this.eventEmitters.get(eventName);
    if (emitter) {
      emitter.emit(data);
    }
  }
}
```

### 事件类型

```typescript
// 1. Agent 生命周期
agent_start     // Agent 开始工作
agent_end       // Agent 结束工作

// 2. Turn 生命周期
turn_start      // 新一轮开始
turn_end        // 一轮结束

// 3. 消息生命周期
message_start   // 消息开始
message_update  // 消息更新（流式）
message_end     // 消息结束

// 4. 工具调用
tool_call       // 工具调用开始
tool_result     // 工具调用结果

// 5. 状态变更
state_changed  // Agent 状态变更

// 6. 错误
error           // 错误发生
```

### 事件监听

```typescript
// 使用示例
const agent = new Agent(config);

// 订阅所有事件
const unsubscribe = agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      console.log("Agent started");
      break;
      
    case "message_start":
      console.log("Message started");
      break;
      
    case "message_update":
      console.log("Message update:", event.delta);
      break;
      
    case "tool_call":
      console.log("Tool call:", event.toolName, event.input);
      break;
      
    case "turn_end":
      console.log("Turn ended");
      break;
      
    case "agent_end":
      console.log("Agent ended");
      unsubscribe(); // 取消订阅
      break;
  }
});
```

---

## 状态管理

### 状态更新机制

```typescript
class Agent {
  private updateState(updateFn: (state: AgentState) => void): void {
    const oldState = this.state;
    const newState = { ...this.state };
    
    // 应用更新
    updateFn(newState);
    
    // 通知监听器
    this.emit("state_changed", {
      old: oldState,
      new: newState
    });
    
    // 更新内部状态
    this.state = newState;
  }
  
  // ========== 状态修改方法 ==========
  
  // 设置系统提示词
  setSystemPrompt(systemPrompt: string): void {
    this.updateState(state => {
      state.systemPrompt = systemPrompt;
    });
  }
  
  // 设置模型
  setModel(model: Model<any>): void {
    this.updateState(state => {
      state.model = model;
      state.thinkingLevel = getDefaultThinkingLevel(model);
    });
  }
  
  // 设置思考级别
  setThinkingLevel(level: ThinkingLevel): void {
    this.updateState(state => {
      state.thinkingLevel = level;
    });
  }
  
  // 设置工具
  setTools(tools: AgentTool<any>[]): void {
    this.updateState(state => {
      state.tools = tools;
    });
  }
  
  // 替换消息
  replaceMessages(messages: AgentMessage[]): void {
    this.updateState(state => {
      state.messages = messages;
    });
  }
  
  // 添加消息
  appendMessage(message: AgentMessage): void {
    this.updateState(state => {
      state.messages.push(message);
    });
  }
}
```

### 状态查询

```typescript
// 获取当前状态
getState(): AgentState {
  return this.state;
}

// 获取配置
getConfig(): AgentConfig {
  return this.config;
}

// 是否空闲
isIdle(): boolean {
  return this.state.isIdle;
}

// 是否在流式传输
isStreaming(): boolean {
  return this.state.isStreaming;
}
```

---

## Steering 和 Follow-up

### Steering 消息队列

```typescript
// 用户打断消息队列
interface SteeringState {
  queue: AgentMessage[];
  mode: "one-at-a-time" | "all";
}

class Agent {
  private steering: SteeringState = {
    queue: [],
    mode: "one-at-a-time"  // 默认：一次处理一个
  };
  
  // ========== Steering 方法 ==========
  
  // 提交 steering 消息
  steer(message: string | AgentMessage): void {
    const steeringMsg: AgentMessage = {
      role: "user",
      content: typeof message === "string" ? message : message.content,
      timestamp: Date.now()
    };
    
    this.steering.queue.push(steeringMsg);
    
    // 如果 Agent 空闲，立即处理
    if (this.state.isIdle) {
      this.processSteeringQueue();
    }
  }
  
  // 处理 steering 队列
  private async processSteeringQueue(): Promise<void> {
    if (this.steering.queue.length === 0) return;
    
    // 根据模式处理
    const mode = this.steering.mode;
    const messagesToProcess = mode === "all"
      ? [...this.steering.queue]  // 处理所有
      : [this.steering.queue.shift()]; // 只处理第一个
    
    // 清空队列
    if (mode === "all") {
      this.steering.queue = [];
    } else {
      this.steering.queue.splice(0, 1);  // 移除已处理的
    }
    
    // 添加到消息历史
    for (const msg of messagesToProcess) {
      this.state.messages.push(msg);
    }
    
    // 发起新的 turn
    await this.promptInternal();
  }
}
```

### Follow-up 消息队列

```typescript
// 队列的后续消息
interface FollowUpState {
  queue: AgentMessage[];
  mode: "one-at-a-time" | "all";
}

class Agent {
  private followUp: FollowUpState = {
    queue: [],
    mode: "all"  // 默认：处理所有
  };
  
  // ========== Follow-up 方法 ==========
  
  // 提交 follow-up 消息
  followUp(message: string | AgentMessage): void {
    const followUpMsg: AgentMessage = {
      role: "user",
      content: typeof message === "string" ? message : message.content,
      timestamp: Date.now()
    };
    
    this.followUp.queue.push(followUpMsg);
  }
  
  // Agent 完全空闲后处理队列
  private async processFollowUpQueue(): Promise<void> {
    if (this.followUp.queue.length === 0) return;
    
    // 等待完全空闲
    await this.waitForIdle();
    
    // 根据模式处理
    const mode = this.followUp.mode;
    const messagesToProcess = mode === "all"
      ? [...this.followUp.queue]
      : [this.followUp.queue.shift()];
    
    // 清空队列
    if (mode === "all") {
      this.followUp.queue = [];
    }
    
    // 添加到消息历史
    for (const msg of messagesToProcess) {
      this.state.messages.push(msg);
    }
    
    // 发起新的 turn
    await this.promptInternal();
  }
}
```

### 队列处理逻辑

```typescript
// 在 Agent 循环中检查队列
private async processQueues(): Promise<void> {
  // 1. 检查 steering 队列
  if (this.steering.queue.length > 0) {
    // 如果正在执行工具，等待完成后处理 steering
    if (this.state.pendingToolCalls.size > 0) {
      await this.waitForToolsComplete();
    }
    await this.processSteeringQueue();
  }
  
  // 2. 检查 follow-up 队列
  if (this.followUp.queue.length > 0) {
    await this.processFollowUpQueue();
  }
}

// 检查是否需要处理队列
private shouldProcessQueues(event: AgentEvent): boolean {
  // 在工具调用完成后检查
  if (event.type === "tool_result" && this.isQueueEmpty()) {
    return true;
  }
  
  // 在 turn 结束后检查
  if (event.type === "turn_end" && this.isQueueEmpty()) {
    return true;
  }
  
  return false;
}

private isQueueEmpty(): boolean {
  return this.steering.queue.length === 0 && this.followUp.queue.length === 0;
}
```

---

## Abort 机制

### Abort 实现

```typescript
class Agent {
  private abortController: AbortController;
  private abortReason?: string;
  
  // ========== Abort 方法 ==========
  
  // 取消当前操作
  abort(reason?: string): void {
    this.abortReason = reason || "User aborted";
    this.state.isAborting = true;
    
    // 1. 取消所有挂起的工具调用
    for (const [id, call] of this.pendingToolCalls) {
      call.abortController.abort(reason);
    }
    this.pendingToolCalls.clear();
    
    // 2. 取消当前活动的工具调用
    if (this.activeToolCall) {
      this.activeToolCall.abortController.abort(reason);
    this.activeToolCall = undefined;
    }
    
    // 3. 取消 Agent 循环的 AbortController
    this.abortController.abort(reason);
  }
  
  // 等待空闲
  async waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
      const checkIdle = () => {
        if (this.state.isIdle) {
          resolve(undefined);
        } else {
          setTimeout(checkIdle, 100);  // 轮询
        }
      };
      
      checkIdle();
    });
  }
}
```

### Abort 流程

```typescript
// 用户调用 abort()
const agent = new Agent(config);

// 用户按 Ctrl+C 或中断按钮
agent.abort("User interrupted");

// Abort 流：
// 1. 设置 isAborting = true
// 2. 取消所有挂起的工具调用
// 3. 取消当前活动的工具调用
// 4. 取消 Agent 循环的 AbortController
// 5. Agent 循环捕获 AbortError 并清理
// 6. 返回 agent_end 事件
```

### Abort 恢复

```typescript
// Agent 循环中的 abort 处理
try {
  for await (const event of this.runAgentLoop()) {
    // ... 处理事件 ...
  }
} catch (error) {
  if (error instanceof AgentAbortedError) {
    // 1. 清理状态
    this.state.isStreaming = false;
    this.state.streamMessage = undefined;
    this.state.pendingToolCalls.clear();
    this.state.activeToolCall = undefined;
    
    // 2. 设置错误状态
    this.state.error = error.reason;
    
    // 3. 发出事件
    this.emit("agent_end", { reason: error.reason });
  } else {
    throw error;
  }
}
```

---

## 工具执行集成

### 工具调用流程

```typescript
// 工具调用事件处理
private handleToolCall(event: ToolCallEvent): void {
  const { toolCallId, toolName, input } = event;
  
  // 1. 查找工具定义
  const tool = this.state.tools.find(t => t.name === toolName);
  if (!tool) {
    this.emit("error", { error: new Error(`Tool not found: ${toolName}`) });
    return;
  }
  
  // 2. 创建 PendingToolCall
  const pendingCall: PendingToolCall = {
    toolCallId,
    toolName,
    input,
    abortController: new AbortController(),
    result: undefined
  };
  
  // 3. 添加到待处理
  this.state.pendingToolCalls.set(toolCallId, pendingCall);
  
  // 4. 设置为活动工具调用
  this.activeToolCall = {
    toolCallId,
    toolName,
    input,
    abortController: pendingCall.abortController
  };
  
  // 5. 发出工具调用开始事件
  this.emit("tool_call", {
    toolCallId,
    toolName,
    input
  });
}
```

### 工具结果处理

```typescript
private handleToolResult(event: ToolResultEvent): void {
  const { toolCallId, content, isError } = event;
  
  // 1. 从待处理中移除
  const pendingCall = this.state.pendingToolCalls.get(toolCallId);
  if (!pendingCall) {
    this.emit("error", { error: new Error(`Tool call not found: ${toolCallId}`) });
    return;
  }
  
  // 2. 记录结果
  pendingCall.result = {
    content,
    isError
  };
  
  // 3. 从待处理中移除
  this.state.pendingToolCalls.delete(toolCallId);
  
  // 4. 如果是最后一个工具调用，检查队列
  if (this.state.pendingToolCalls.size === 0 && this.isQueueEmpty()) {
    // 调用队列处理
    this.processQueues().catch(error => {
      this.state.error = error.message;
    });
  }
  
  // 5. 发出工具结果事件
  this.emit("tool_result", {
    toolCallId,
    toolName: pendingCall.toolName,
    content,
    isError
  });
}
```

### 工具并发执行

```typescript
// 如果工具之间没有依赖关系，可以并行执行
class Agent {
  // 检查工具是否可以并发执行
  private canExecuteInParallel(tools: ToolCall[]): boolean {
    // 检查工具是否有依赖
    // 如果所有工具都是独立的，可以并发执行
    // 简单规则：检查工具名称是否有已知依赖关系
    const toolNames = tools.map(t => t.toolName);
    const hasDependencies = checkToolDependencies(toolNames);
    return !hasDependencies;
  }
  
  // 批量执行工具
  private async executeToolsInParallel(tools: ToolCall[]): Promise<ToolResultEvent[]> {
    const promises = tools.map(tool => {
      const toolDef = this.state.tools.find(t => t.name === tool.toolName);
      if (!toolDef) {
        return Promise.reject(new Error(`Tool not found: ${tool.toolName}`));
      }
      
      const pendingCall: PendingToolCall = {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        input: tool.input,
        abortController: new AbortController(),
        result: undefined
      };
      
      this.state.pendingToolCalls.set(tool.toolCallId, pendingCall);
      
      return toolDef.execute(
        tool.toolCallId,
        pendingCall.input,
        this.abortController.signal,
        (update) => {
          this.emit("tool_result", {
            toolCallId: tool.toolCallId,
            toolName: tool.toolName,
            content: update.content,
            isError: update.isError || false
          });
        },
        this.getContext()
      );
    });
    
    // 并发执行
    const results = await Promise.allSettled(promises);
    
    // 清理待处理
    for (const [id, call] of this.state.pendingToolCalls) {
      this.state.pendingToolCalls.delete(id);
    }
    
    return results;
  }
}
```

---

## 流式更新

### 工具调用流式更新

```typescript
// 工具执行过程中的流式更新
interface ToolUpdate {
  progress: number;           // 进度百分比 (0-100)
  status: string;            // 状态描述
  details?: any;            // 额外详情
  output: string;            // 输出内容（流式）
  error?: string;             // 错误信息（如果有）
}

// 工具执行函数中的 onUpdate 用法
async execute(
  toolCallId: string,
  params: TParams,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<ToolDetails> | undefined,
  ctx: ExtensionContext
): Promise<AgentToolResult<TDetails>> {
  // 1. 发送开始通知
  onUpdate?.({
    content: [{ type: "text", text: "Starting deployment..." }],
    details: { progress: 0 }
  });
  
  // 2. 执行步骤 1
  await step1(params);
  onUpdate?.({
    content: [{ type: "text", text: "Building Docker image..." }],
    details: { progress: 25 }
  });
  
  // 3. 执行步骤 2
  await step2(params);
  onUpdate?.({
    content: [{ type: "text", text: "Deploying to production..." }],
    details: { progress: 50 }
  });
  
  // 4. 执行步骤 3
  await step3(params);
  onUpdate?.({
    content: [{ type: "text", text: "Health check..." }],
    details: { progress: 75 }
  });
  
  // 5. 完成通知
  onUpdate?.({
    content: [{ type: "text", text: "Deployment successful!" }],
    details: { progress: 100 }
  });
  
  return {
    content: [{ type: "text", text: "Deployment complete" }],
    details: { deploymentId: "deploy-123" }
  };
}
```

### UI 更新集成

```typescript
// Agent 类中的事件处理集成到 UI
class Agent {
  private processStream(): void {
    for await (const event of this.runAgentLoop()) {
      // 消息开始
      if (event.type === "message_start") {
        this.ui?.showMessage({
          type: "assistant",
          content: []
        });
      }
      
      // 消息更新（流式）
      if (event.type === "message_update") {
        this.ui?.updateMessage(event.delta);
      }
      
      // 消息结束
      if (event.type === "message_end") {
        this.ui?.showMessage(event.message);
      }
      
      // 工具调用
      if (event.type === "tool_call") {
        this.ui?.showToolCall({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input
        });
      }
      
      // 工具结果
      if (event.type === "tool_result") {
        this.ui?.showToolResult({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: event.content
        });
      }
      
      // 状态更新
      if (event.type === "state_changed") {
        this.ui?.updateState(event.new);
      }
    }
  }
}
```

---

## 核心优势

### 1. 事件驱动架构
- 清晰的事件流
- 易于理解和调试
- 支持多个订阅者
- 松耦合设计

### 2. 流式消息处理
- 支持文本、图片、工具调用
- 实时 UI 更新
- 差分渲染优化

### 3. 灵活的队列机制
- Steering 消息队列（打断）
- Follow-up 消息队列（排队）
- 可配置的处理模式（one-at-a-time / all）

### 4. 工具执行集成
- 并行工具执行支持
- 流式进度更新
- 详细的错误处理
- 工具依赖检查

### 5. 强大的 Abort 支持
- 随时取消工具调用
- 清理所有资源
- 优雅的错误处理

### 6. 状态管理
- 响应式状态更新
- 状态变更事件
- 查询 API 完整

---

## 关键源码文件

- `packages/agent/src/agent.ts` - Agent 类实现（300+ 行）
- `packages/agent/src/agent-loop.ts` - Agent 循环实现（500+ 行）
- `packages/agent/src/types.ts` - 类型定义（100+ 行）

---

**下一步**: 深度分析 #5 TUI 终端 UI
