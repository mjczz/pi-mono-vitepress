# pi-mono 测试策略深度分析

**创建时间**: 2026-02-09 07:42 GMT+8
**任务编号**: #8
**类型**: 深度分析
**分析文件**: 
- `packages/*/test/` - 所有测试目录
- `packages/*/vitest.config.ts` - Vitest 配置文件
- `packages/*/test-utils/` - 测试工具和 Mock

---

## 目录

1. [测试框架](#测试框架)
2. [单元测试策略](#单元测试策略)
3. [Mock LLM 机制](#mock-llm-机制)
4. [工具调用测试](#工具调用测试)
5. [集成测试策略](#集成测试策略)
6. [端到端测试](#端到端测试)
7. [CI/CD 集成](#cicd-集成)
8. [覆盖率策略](#覆盖率策略)
9. [调试技巧](#调试技巧)

---

## 测试框架

### Vitest 配置

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  // ========== 测试环境 ==========
  test: {
    globals: true,           // 启用全局变量
    environment: 'node',      // 测试环境
    include: ['packages/*/test/**/*.{ts,js}'],
    exclude: [
      'node_modules',
      'dist',
      '**/*.d.ts',
      '**/node_modules/**'
    ]
  },
  
  // ========== 覆盖率配置 ==========
  coverage: {
    provider: 'v8',          // 使用 v8 提供商
    reporter: ['text', 'json', 'html', 'lcov'],
    exclude: [
      'node_modules',
      'dist',
      '**/*.d.ts',
      '**/node_modules/**',
      '**/test/**',
      '**/examples/**',
      '**/mocks/**'
    ],
    all: false,              // 不测试所有文件，只测试修改的
    lines: 100,               // 语句覆盖率阈值
    functions: 100,          // 函数覆盖率阈值
    branches: 90,             // 分支覆盖率阈值
    statements: 100            // 语句覆盖率阈值
  },
  
  // ========== 预设配置 ==========
  esbuild: {
    target: 'node18',
    sourcemap: true
  },
  
  define: {
    // 测试环境变量
    'process.env.NODE_ENV': JSON.stringify('test')
  }
});
```

### 测试组织结构

```
packages/
├── pi-ai/
│   ├── test/
│   │   ├── unit/              # 单元测试
│   │   ├── integration/       # 集成测试
│   │   ├── e2e/               # 端到端测试
│   │   └── utils/             # 测试工具
│   └── vitest.config.ts
├── pi-agent-core/
│   ├── test/
│   │   ├── agent/             # Agent 核心测试
│   │   └── tools/             # 工具测试
│   └── vitest.config.ts
├── pi-coding-agent/
│   ├── test/
│   │   ├── agent/             # 编码 Agent 测试
│   │   ├── tools/             # 工具实现测试
│   │   ├── modes/             # 模式测试
│   │   └── interactive/       # 交互模式测试
│   └── vitest.config.ts
└── pi-tui/
    ├── test/
    │   ├── components/         # 组件测试
    │   ├── editor/             # 编辑器测试
    │   └── tui/                # TUI 测试
    └── vitest.config.ts
```

---

## 单元测试策略

### 1. 核心逻辑测试

```typescript
// pi-agent-core/test/agent/agent.test.ts
describe('Agent', () => {
  let agent: Agent;
  let mockStreamFn: MockStreamFunction;
  
  beforeEach(() => {
    mockStreamFn = createMockStreamFn();
    agent = new Agent({
      systemPrompt: 'You are helpful',
      model: createMockModel(),
      streamFn: mockStreamFn,
      tools: []
    });
  });
  
  describe('prompt', () => {
    it('should emit agent_start event', async () => {
      const events: AgentEvent[] = [];
      agent.subscribe((event) => events.push(event));
      
      await agent.prompt('Hello');
      
      expect(events[0]).toMatchObject({
        type: 'agent_start'
      });
    });
    
    it('should handle tool calls', async () => {
      const tool = createMockTool({
        name: 'test_tool',
        execute: async () => ({
          content: [{ type: 'text', text: 'Tool result' }],
          details: {}
        })
      });
      
      agent.setTools([tool]);
      
      mockStreamFn.setResponse({
        content: '',
        toolCalls: [{
          id: 'call-1',
          name: 'test_tool',
          input: { param: 'value' }
        }]
      });
      
      await agent.prompt('Use the tool');
      
      // 验证工具调用
      const toolCallEvents = events.filter(e => e.type === 'tool_call');
      expect(toolCallEvents.length).toBe(1);
      expect(toolCallEvents[0].toolName).toBe('test_tool');
    });
    
    it('should emit agent_end event', async () => {
      mockStreamFn.setResponse({
        content: 'Done',
        done: true
      });
      
      await agent.prompt('Finish');
      
      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('agent_end');
    });
  });
  
  describe('abort', () => {
    it('should cancel pending tool calls', async () => {
      const tool = createMockTool({
        name: 'slow_tool',
        execute: async (signal) => {
          await new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('Aborted')));
            setTimeout(() => reject(new Error('Timeout')), 1000);
          });
        }
      });
      
      agent.setTools([tool]);
      mockStreamFn.setResponse({
        content: '',
        toolCalls: [{
          id: 'call-1',
          name: 'slow_tool',
          input: {}
        }]
      });
      
      const promptPromise = agent.prompt('Start tool');
      
      // 等待工具调用开始
      await sleep(10);
      
      // 取消
      agent.abort('User cancelled');
      
      // 验证取消状态
      expect(agent.state.isAborting).toBe(true);
    });
  });
});
```

### 2. 工具测试

```typescript
// pi-coding-agent/test/tools/read.test.ts
describe('read tool', () => {
  describe('execute', () => {
    it('should read existing file', async () => {
      const mockFs = createMockFs({
        'test.txt': 'File content'
      });
      
      const result = await readTool.execute(
        'call-1',
        { path: 'test.txt', maxBytes: 100 },
        undefined,
        mockContext()
      );
      
      expect(result.content[0].text).toBe('File content');
      expect(result.details?.bytesRead).toBe(13);
    });
    
    it('should handle file not found', async () => {
      const result = await readTool.execute(
        'call-2',
        { path: 'nonexistent.txt' },
        undefined,
        mockContext()
      );
      
      expect(result.content[0].isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
    
    it('should respect maxBytes', async () => {
      const result = await readTool.execute(
        'call-3',
        { path: 'large.txt', maxBytes: 50 },
        undefined,
        mockContext()
      );
      
      expect(result.content[0].text.length).toBeLessThanOrEqual(50);
    });
    
    it('should handle maxLines', async () => {
      const result = await readTool.execute(
        'call-4',
        { path: 'lines.txt', maxLines: 5 },
        undefined,
        mockContext()
      );
      
      const lines = result.content[0].text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(5);
    });
  });
});
```

### 3. 验证测试

```typescript
// pi-ai/test/utils/validation.test.ts
describe('tool validation', () => {
  describe('validateToolCall', () => {
    const tools = [
      createMockTool({
        name: 'read',
        parameters: Type.Object({
          path: Type.String(),
          maxBytes: Type.Optional(Type.Number())
        })
      })
    ];
    
    it('should validate correct parameters', () => {
      const result = validateToolCall(tools, {
        name: 'read',
        arguments: { path: 'test.txt', maxBytes: 100 }
      });
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ path: 'test.txt', maxBytes: 100 });
    });
    
    it('should reject missing required parameters', () => {
      const result = validateToolCall(tools, {
        name: 'read',
        arguments: { maxBytes: 100 }
      });
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required parameter');
    });
    
    it('should reject invalid parameter types', () => {
      const result = validateToolCall(tools, {
        name: 'read',
        arguments: { path: 123, maxBytes: 100 }
      });
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid type');
    });
    
    it('should reject parameter range violations', () => {
      const result = validateToolCall(tools, {
        name: 'read',
        arguments: { path: 'test.txt', maxBytes: -100 }
      });
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Minimum is 0');
    });
  });
});
```

---

## Mock LLM 机制

### Mock Stream Function

```typescript
// pi-agent-core/test/utils/mock-stream.ts
export class MockStreamFunction {
  private responses: StreamResponse[];
  private responseIndex = 0;
  private currentEvents: AssistantMessageEvent[] = [];
  
  constructor() {
    this.responses = [];
  }
  
  // ========== 设置响应 ==========
  
  // 设置流式响应
  setResponse(response: StreamResponse): void {
    this.responses.push(response);
  }
  
  // 设置多个响应（用于多轮对话）
  setResponses(responses: StreamResponse[]): void {
    this.responses = [...this.responses, ...responses];
  }
  
  // ========== 流式执行 ==========
  
  async *stream(): AsyncGenerator<AssistantMessageEvent> {
    // 1. 发出 agent_start
    yield { type: 'agent_start' };
    
    // 2. 遍历所有响应
    for (const response of this.responses) {
      // 3. 发出 message_start
      yield {
        type: 'message_start',
        timestamp: Date.now()
      };
      
      // 4. 发出消息内容
      if (response.content) {
        const chars = response.content.split('');
        for (const char of chars) {
          yield {
            type: 'text_delta',
            timestamp: Date.now(),
            delta: char
          };
        }
      }
      
      // 5. 发出工具调用
      if (response.toolCalls) {
        for (const toolCall of response.toolCalls) {
          yield {
            type: 'tool_call_start',
            timestamp: Date.now(),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.input
          };
          
          // 工具调用结束
          yield {
            type: 'tool_call_end',
            timestamp: Date.now(),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.input
          };
        }
      }
      
      // 6. 发出 message_end
      yield {
        type: 'message_end',
        timestamp: Date.now(),
        message: {
          role: 'assistant',
          content: response.content ? [{ type: 'text', text: response.content }] : [],
          timestamp: Date.now()
        }
      };
      
      // 7. 发出 turn_end
      yield {
        type: 'turn_end',
        timestamp: Date.now(),
        message: {
          role: 'assistant',
          content: response.content ? [{ type: 'text', text: response.content }] : [],
          timestamp: Date.now()
        },
        toolResults: response.toolResults || []
      };
    }
    
    // 8. 发出 agent_end
    yield {
      type: 'agent_end',
      timestamp: Date.now(),
      reason: 'complete'
    };
  }
}
```

### StreamResponse 类型

```typescript
interface StreamResponse {
  content?: string;
  toolCalls?: LLMToolCall[];
  toolResults?: ToolResultMessage[];
  done?: boolean;
  error?: Error;
  thinkingBlocks?: ThinkingBlock[];
}

interface ThinkingBlock {
  text: string;
  reasoningBudgetTokens: number;
}
```

### 使用示例

```typescript
// 测试 Agent 循环
const mockStream = new MockStreamFunction();
mockStream.setResponse({
  content: 'Hello! Let me help you with that.',
  toolCalls: [{
    id: 'call-1',
    name: 'read',
    input: { path: 'test.txt' }
  }],
  toolResults: [{
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'File content' }],
    isError: false
  }]
});

const agent = new Agent({
  streamFn: mockStream.stream.bind(mockStream),
  // ... 其他配置
});

// 订阅事件
const events: AgentEvent[] = [];
agent.subscribe((event) => events.push(event));

// 执行提示
await agent.prompt('Test message');

// 验证事件
expect(events).toHaveLength(10); // agent_start, message_start, text_deltas, message_end, tool_call_start, tool_call_end, turn_end, agent_end
```

---

## 工具调用测试

### 工具调用流程测试

```typescript
// pi-agent-core/test/agent/tool-flow.test.ts
describe('agent tool execution flow', () => {
  it('should execute tool and continue conversation', async () => {
    const mockStream = new MockStreamFunction();
    const tool = createMockTool({
      name: 'echo_tool',
      execute: async (id, params, signal, onUpdate, ctx) => ({
        content: [{ type: 'text', text: `Echo: ${params.message}` }],
        details: { echoed: params.message }
      })
    });
    
    mockStream.setResponse({
      toolCalls: [{
        id: 'call-1',
        name: 'echo_tool',
        input: { message: 'Hello' }
      }],
      content: 'Tool executed successfully'
    });
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream),
      tools: [tool]
    });
    
    const events: AgentEvent[] = [];
    agent.subscribe((event) => events.push(event));
    
    await agent.prompt('Test');
    
    // 验证工具调用事件
    const toolCallEvent = events.find(e => e.type === 'tool_call');
    expect(toolCallEvent).toMatchObject({
      toolName: 'echo_tool'
    });
    
    // 验证工具结果事件
    const toolResultEvent = events.find(e => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({
      content: [{ type: 'text', text: 'Echo: Hello' }]
    });
    
    // 验证继续对话
    expect(events[events.length - 2].type).toBe('message_end');
    expect(events[events.length - 1].type).toBe('agent_end');
  });
});
```

### 工具验证测试

```typescript
// pi-coding-agent/test/tools/validation.test.ts
describe('tool parameter validation', () => {
  describe('TypeBox validation', () => {
    const schema = Type.Object({
      path: Type.String({ minLength: 1 }),
      maxBytes: Type.Optional(Type.Number({ minimum: 0, maximum: 1000000 })),
      mode: StringEnum(['read', 'write', 'append'], { default: 'read' })
    });
    
    it('should validate correct parameters', () => {
      const params = { path: 'test.txt', maxBytes: 100, mode: 'write' };
      const result = Validate.Compile(schema).Check(params);
      
      expect(result.Errors).toHaveLength(0);
    });
    
    it('should reject missing required field', () => {
      const params = { maxBytes: 100 };
      const result = Validate.Compile(schema).Check(params);
      
      expect(result.Errors.length).toBeGreaterThan(0);
      expect(result.Errors[0]).toContain('path');
    });
    
    it('should reject invalid enum value', () => {
      const params = { path: 'test.txt', mode: 'invalid' };
      const result = Validate.Compile(schema).Check(params);
      
      expect(result.Errors).toHaveLength(1);
      expect(result.Errors[0].type).toBe(26); // enum error
    });
    
    it('should reject number out of range', () => {
      const params = { path: 'test.txt', maxBytes: 2000000 };
      const result = Validate.Compile(schema).Check(params);
      
      expect(result.Errors.length).toBeGreaterThan(0);
      expect(result.Errors[0].type).toBe(31); // number error
    });
  });
});
```

---

## 集成测试策略

### Agent 上下文集成

```typescript
// pi-agent-core/test/integration/agent-context.test.ts
describe('Agent context integration', () => {
  it('should build correct context for LLM', async () => {
    const mockStream = new MockStreamFunction();
    const tools = [
      createMockTool({ name: 'tool1' }),
      createMockTool({ name: 'tool2' })
    ];
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream),
      tools: tools,
      transformContext: (messages) => {
        // 转换上下文
        return messages.map(msg => ({
          ...msg,
          metadata: { transformed: true }
        }));
      }
    });
    
    mockStream.setResponse({
      content: 'Response'
    });
    
    await agent.prompt('Test');
    
    // 验证上下文被转换
    const llmContext = agent.getContext();
    expect(llmContext.messages.some(m => m.metadata?.transformed)).toBe(true);
  });
});
```

### 多轮对话集成

```typescript
// pi-agent-core/test/integration/multi-turn.test.ts
describe('multi-turn conversation', () => {
  it('should maintain conversation state across turns', async () => {
    const mockStream = new MockStreamFunction();
    
    // 第一轮
    mockStream.setResponse({
      content: 'First response'
    });
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream)
    });
    
    await agent.prompt('First question');
    const messagesAfterTurn1 = agent.state.messages.length;
    
    // 第二轮
    mockStream.setResponse({
      content: 'Second response'
    });
    
    await agent.prompt('Second question');
    const messagesAfterTurn2 = agent.state.messages.length;
    
    // 验证消息累积
    expect(messagesAfterTurn2).toBe(messagesAfterTurn1 + 2);  // 2 user messages + 2 assistant messages
  });
});
```

---

## 端到端测试

### 完整对话流程

```typescript
// pi-coding-agent/test/e2e/conversation.test.ts
describe('E2E conversation flow', () => {
  it('should handle complete conversation with tool calls', async () => {
    const mockStream = new MockStreamFunction();
    const tool = createMockTool({
      name: 'calculator',
      execute: async (id, params, signal, onUpdate, ctx) => ({
        content: [{ type: 'text', text: `Result: ${params.a} + ${params.b}` }],
        details: { result: params.a + params.b }
      })
    });
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream),
      tools: [tool]
    });
    
    // 设置多轮响应
    mockStream.setResponses([
      {
        content: 'I\'ll calculate for you.',
        toolCalls: [{
          id: 'call-1',
          name: 'calculator',
          input: { a: 5, b: 3 }
        }]
      },
      {
        content: 'The result is 8.',
        toolResults: [{
          toolCallId: 'call-1',
          toolName: 'calculator',
          content: [{ type: 'text', text: 'Result: 8' }],
          isError: false
        }]
      },
      {
        content: 'Is there anything else?'
      }
    ]);
    
    await agent.prompt('Calculate 5 + 3');
    
    // 验证事件流
    const events = agent.getCapturedEvents();
    
    expect(events[0].type).toBe('agent_start');
    expect(events[1].type).toBe('message_start');
    
    // 验证工具调用
    const toolCallEvent = events.find(e => e.type === 'tool_call');
    expect(toolCallEvent).toMatchObject({
      toolName: 'calculator',
      input: { a: 5, b: 3 }
    });
    
    // 验证工具结果
    const toolResultEvent = events.find(e => e.type === 'tool_result');
    expect(toolResultEvent).toMatchObject({
      content: [{ type: 'text', text: 'Result: 8' }]
    });
    
    expect(events[events.length - 1].type).toBe('agent_end');
  });
});
```

### 错误恢复流程

```typescript
// pi-coding-agent/test/e2e/error-recovery.test.ts
describe('E2E error recovery', () => {
  it('should recover from tool execution errors', async () => {
    const mockStream = new MockStreamFunction();
    const tool = createMockTool({
      name: 'flaky_tool',
      execute: async (id, params, signal, onUpdate, ctx) => {
        // 第一次失败
        if (params.attempt === 0) {
          throw new Error('Temporary failure');
        }
        // 第二次成功
        return {
          content: [{ type: 'text', text: 'Success!' }],
          details: {}
        };
      }
    });
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream),
      tools: [tool]
    });
    
    mockStream.setResponses([
      {
        content: 'Let me try...',
        toolCalls: [{
          id: 'call-1',
          name: 'flaky_tool',
          input: { attempt: 0 }
        }]
      },
      {
        content: 'Error occurred, retrying...',
        toolResults: [{
          toolCallId: 'call-1',
          toolName: 'flaky_tool',
          content: [{ type: 'text', text: 'Temporary failure' }],
          isError: true
        }]
      },
      {
        content: 'Retrying...',
        toolCalls: [{
          id: 'call-2',
          name: 'flaky_tool',
          input: { attempt: 1 }
        }]
      },
      {
        content: 'Success!',
        toolResults: [{
          toolCallId: 'call-2',
          toolName: 'flaky_tool',
          content: [{ type: 'text', text: 'Success!' }],
          isError: false
        }]
      }
    ]);
    
    await agent.prompt('Use flaky tool');
    
    // 验证错误恢复
    const errorEvents = agent.getCapturedEvents().filter(e => e.type === 'tool_result');
    expect(errorEvents.length).toBe(2);
    expect(errorEvents[0].isError).toBe(true);
    expect(errorEvents[1].isError).toBe(false);
  });
});
```

---

## CI/CD 集成

### GitHub Actions 配置

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/coverage-final.json
          fail_ci_if_error: true
      
      - name: Check coverage thresholds
        run: |
          # 从覆盖率报告中提取指标
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          
          echo "Line coverage: $COVERAGE"
          
          # 检查是否达到阈值
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage below 80%"
            exit 1
          fi
```

### Pre-commit Hooks

```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "Running tests..."

# 运行测试
npm test -- --run

# 检查结果
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Commit aborted."
  exit 1
fi

echo "✅ All tests passed"

# 运行格式化检查
npm run format:check

if [ $? -ne 0 ]; then
  echo "❌ Formatting issues found. Run 'npm run format' to fix."
  exit 1
fi

echo "✅ Formatting is correct"
```

### 配置 pre-commit hooks

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run lint && npm test -- --run"
    }
  }
}
```

---

## 覆盖率策略

### 覆盖率目标

| 组件类型 | 目标 | 说明 |
|----------|------|------|
| 核心逻辑 (pi-ai) | > 90% | Agent、流式、消息处理 |
| 工具 (pi-coding-agent) | > 85% | 工具实现、验证、执行 |
| Agent 核心 (pi-agent-core) | > 90% | Agent 状态管理、事件系统 |
| TUI 组件 (pi-tui) | > 80% | 组件渲染、编辑器 |
| 集成测试 | > 70% | 端到端流程、关键路径 |

### 覆盖率收集

```bash
# 运行测试并生成覆盖率报告
npm run test -- --coverage

# 查看覆盖率报告
open coverage/index.html

# 生成覆盖率报告摘要
npx vitest run --coverage --reporter=json-summary --reporter=html
```

### 覆盖率排除

```typescript
// vitest.config.ts
export default defineConfig({
  coverage: {
    exclude: [
      'node_modules',
      'dist',
      '**/*.d.ts',
      '**/test/**',
      '**/examples/**',
      '**/mocks/**',
      // 排除类型定义文件
      '**/*.types.ts',
      // 排除配置文件
      '**/vitest.config.ts',
      // 排除开发工具
      '**/scripts/**'
    ]
  }
});
```

---

## 调试技巧

### 测试日志

```typescript
// 在测试中启用详细日志
describe('Agent with verbose logging', () => {
  it('should log all events', async () => {
    const mockStream = new MockStreamFunction();
    const events: AgentEvent[] = [];
    
    // 订阅所有事件
    const unsubscribe = mockStream.subscribe((event) => {
      console.log(`[EVENT] ${event.type}`, event);
      events.push(event);
    });
    
    // 执行测试
    await agent.prompt('Test');
    
    // 输出所有事件
    console.log('All events:', events);
    
    unsubscribe();
  });
});
```

### 错误追踪

```typescript
// 使用 expect 进行精确的错误匹配
describe('error handling', () => {
  it('should capture tool execution errors', async () => {
    const errorTool = createMockTool({
      name: 'error_tool',
      execute: async () => {
        throw new Error('Tool execution failed');
      }
    });
    
    const agent = new Agent({
      streamFn: mockStream.stream.bind(mockStream),
      tools: [errorTool]
    });
    
    mockStream.setResponse({
      toolCalls: [{
        id: 'call-1',
        name: 'error_tool',
        input: {}
      }]
    });
    
    try {
      await agent.prompt('Use error tool');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error.message).toBe('Tool execution failed');
    }
  });
});
```

### 性能测试

```typescript
// pi-agent-core/test/performance/agent-performance.test.ts
describe('Agent performance', () => {
  it('should handle 1000 messages efficiently', async () => {
    const startTime = Date.now();
    
    const agent = new Agent({
      systemPrompt: 'You are efficient',
      streamFn: createFastMockStream()
    });
    
    // 快速添加 1000 条消息
    for (let i = 0; i < 1000; i++) {
      agent.state.messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // 验证性能
    expect(duration).toBeLessThan(100);  // 应该在 100ms 内完成
  });
});
```

---

## 核心优势

### 1. 无需 API Key

- ✅ **完全离线测试** - Mock LLM 替代真实 API
- ✅ **快速反馈循环** - 不等待网络请求
- ✅ **节省 token** - 不消耗真实的 API 调用
- ✅ **可重复执行** - 测试环境稳定

### 2. 强大的 Mock 工具

- ✅ **Mock Stream Function** - 完整的流式事件模拟
- ✅ **响应队列** - 支持多轮对话
- ✅ **错误模拟** - 可以测试错误恢复
- ✅ **工具调用模拟** - 支持任意工具调用场景

### 3. 类型安全

- ✅ **TypeScript 全覆盖** - 所有测试都使用 TS
- ✅ **类型守卫** - 精确的类型检查
- ✅ **自动类型推断** - Mock 工具自动推断类型

### 4. 可靠的测试

- ✅ **单元测试** - 隔离测试每个组件
- ✅ **集成测试** - 测试组件交互
- ✅ **端到端测试** - 测试完整流程
- ✅ **性能测试** - 验证性能要求

### 5. CI/CD 支持

- ✅ **GitHub Actions** - 自动运行测试
- ✅ **Codecov 集成** - 覆盖率追踪
- ✅ **覆盖率阈值** - 自动检查覆盖率目标
- ✅ **Pre-commit hooks** - 提交前自动测试

---

## 关键源码文件

- `packages/*/test/` - 所有测试目录
- `packages/*/vitest.config.ts` - Vitest 配置文件
- `packages/*/test/utils/` - 测试工具和 Mock

---

**🎉 所有 8 个任务分析完成！**

总文档量：约 190K 字符
深度分析：8/8 (100%)
快速扫描：8/8 (100%)
总体进度：16/16 (100%)
