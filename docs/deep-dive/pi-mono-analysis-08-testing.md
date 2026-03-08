# pi-mono 测试策略快速扫描

**创建时间**: 2026-02-09 06:41 GMT+8
**任务编号**: #8
**类型**: 快速扫描概览

---

## 核心概念

### 1. AI 代码测试策略

```typescript
// 单元测试示例
import { describe, it, expect } from "vitest";

describe("Tool execution", () => {
  it("should read file successfully", async () => {
    const result = await readTool.execute({
      path: "test.txt",
      toolCallId: "call-1",
      params: { path: "test.txt" },
      signal: undefined,
      onUpdate: undefined,
      ctx: mockContext
    });

    expect(result.content).toEqual([
      { type: "text", text: "test content" }
    ]);
  });

  it("should handle file not found", async () => {
    const result = await readTool.execute({
      path: "nonexistent.txt",
      toolCallId: "call-2",
      params: { path: "nonexistent.txt" },
      signal: undefined,
      onUpdate: undefined,
      ctx: mockContext
    });

    expect(result.content[0].isError).toBe(true);
  });
});
```

### 2. Mock LLM 响应

```typescript
// Mock LLM 工具
import { mockLLM } from "./test-utils/mock-llm.js";

describe("Agent with mock LLM", () => {
  it("should respond to tool call", async () => {
    const agent = new Agent({ model: mockLLM });
    
    await agent.prompt("Execute tool: calc");
    
    // 验证工具调用
    expect(agent.state.messages.length).toBe(2);  // user + assistant(tool)
  });
});
```

**Mock LLM 实现**：

```typescript
// 简单的 Mock LLM
export const mockLLM = {
  id: "mock",
  name: "Mock LLM",
  api: "mock",
  provider: "mock",
  
  async stream(context, options) {
    return {
      [Symbol.asyncIterator]: async function* () {
        // 模拟流式响应
        yield { type: "text_start" };
        yield { type: "text_delta", delta: "Mock response" };
        yield { type: "text_end" };
        yield { type: "done", reason: "stop" };
      }()
    };
  }
};
```

### 3. 工具调用测试

```typescript
// 测试工具参数验证
describe("Tool validation", () => {
  it("should validate required parameters", () => {
    const result = validateToolCall(tools, {
      name: "read",
      arguments: { path: "test.txt" }  // 有效
    });
    
    expect(result).toEqual({ success: true });
  });

  it("should reject invalid parameters", () => {
    const result = validateToolCall(tools, {
      name: "read",
      arguments: { }  // 缺少必需参数
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required parameter");
  });
});
```

### 4. 集成测试策略

```typescript
// 端到端集成测试
import { testAgentFlow } from "./test-utils/e2e-flow.js";

describe("End-to-end scenarios", () => {
  it("should complete simple coding task", async () => {
    const result = await testAgentFlow({
      prompt: "Create a new file with content 'Hello World'",
      expectedFiles: ["hello.txt"],
      tools: ["write", "read"]
    });
    
    expect(result.success).toBe(true);
  });

  it("should handle tool errors gracefully", async () => {
    const result = await testAgentFlow({
      prompt: "Delete non-existent file",
      tools: ["bash"],
      expectedBehavior: "continue despite error"
    });
    
    expect(result.finalState).toContain("File not found");
  });
});
```

---

## 测试工具

### 1. Vitest

**配置**：

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/test/**/*.ts"],
    exclude: ["node_modules", "dist"]
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "json", "html"],
    exclude: ["**/test/**", "**/examples/**"]
  }
});
```

**运行测试**：

```bash
# 所有测试
npm test

# 单个包
npm test --workspace=@mariozechner/pi-ai
npm test --workspace=@mariozechner/pi-agent-core

# 带覆盖率
npm test -- --coverage
```

### 2. Mock 工具

**Mock Context**：

```typescript
// 模拟会话上下文
interface MockContext {
  cwd: string;
  model: Model<any>;
  sessionManager: SessionManager;
}

export function createMockContext(): MockContext {
  return {
    cwd: "/tmp/test",
    model: createMockModel(),
    sessionManager: createMockSessionManager()
  };
}

// Mock Model
export function createMockModel(): Model<any> {
  return {
    id: "mock-model",
    name: "Mock Model",
    api: "mock",
    provider: "mock",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096
  };
}

// Mock SessionManager
export function createMockSessionManager(): SessionManager {
  return {
    cwd: "/tmp/test",
    getSessionFile: () => "/tmp/test-session.jsonl",
    getSessionId: () => "test-session",
    getLeafId: () => "leaf-1",
    getEntry: (id) => undefined,
    getEntries: () => [],
    appendMessage: () => "",
    appendThinkingLevelChange: () => "",
    appendModelChange: () => "",
    appendCompaction: () => "",
    getLabel: (id) => undefined,
    appendCustomEntry: () => "",
    buildSessionContext: () => ({ messages: [], thinkingLevel: "off", model: null })
  };
}
```

---

## 测试组织

### 文件结构

```
packages/ai/test/
├── unit/          # 单元测试
│   ├── providers/  # 提供商特定测试
│   └── stream/      # 流式响应测试
├── integration/   # 集成测试
│   └── e2e/        # 端到端场景
└── utils/         # 测试工具
    ├── mock-llm.ts
    ├── mock-context.ts
    └── e2e-flow.ts
```

### 测试命名约定

```typescript
// 单元测试：describe("<feature> <action>")
describe("read tool", () => {
  it("should read existing file", async () => { ... });
  it("should handle file not found", async () => { ... });
});

// 集成测试：describe("<scenario>")
describe("file upload flow", () => {
  it("should complete successfully", async () => { ... });
  it("should handle errors", async () => { ... });
});
```

---

## Mock LLM 策略

### 1. 行为验证

```typescript
// 测试 LLM 是否调用了正确的工具
const toolCalls = extractToolCalls(mockLLM.streamResult);

expect(toolCalls).toHaveLength(1);
expect(toolCalls[0].name).toBe("read");
expect(toolCalls[0].arguments).toEqual({ path: "test.txt" });
```

### 2. 流式响应测试

```typescript
// 测试流式更新事件
const updates: AgentEvent[] = [];

for await (const event of mockLLM.stream(context)) {
  updates.push(event);
  
  if (event.type === "message_update") {
    // 验证流式内容
    expect(event.delta).toBeDefined();
  }
}
```

### 3. 错误处理测试

```typescript
// 测试错误场景
describe("Error handling", () => {
  it("should handle tool errors", async () => {
    const agent = new Agent({ model: mockLLM });
    
    // Mock 工具返回错误
    const errorTool = createMockTool({
      name: "bash",
      execute: async () => {
        throw new Error("Command failed");
      }
    });
    
    agent.setTools([errorTool]);
    
    // 验证错误被传递
    const result = await agent.prompt("Run failing command");
    expect(result.messages[result.messages.length - 1].content[0].isError).toBe(true);
  });

  it("should handle network errors", async () => {
    const networkErrorLLM = createMockNetworkErrorLLM();
    const agent = new Agent({ model: networkErrorLLM });
    
    await expect(() => agent.prompt("Hello")).rejects();
  });
});
```

---

## 覆盖率策略

### 1. 关键指标

- **语句覆盖率**: 代码行覆盖
- **分支覆盖率**: 条件分支覆盖
- **函数覆盖率**: 函数调用覆盖
- **工具覆盖率**: Agent 工具调用覆盖

### 2. 覆盖率目标

```bash
# 覆盖率目标
- 单元测试：>80%
- 集成测试：>70% 关键路径
- 总体：>75%

# 生成覆盖率报告
npm run test -- --coverage
```

---

## CI/CD 集成

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
```

### Pre-commit Hooks

```bash
#!/bin/sh
# .git/hooks/pre-commit

# 运行测试
npm test

# 如果失败，阻止提交
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Commit aborted."
  exit 1
fi
```

---

## 边界情况处理

### 1. 网络依赖

```typescript
// 跳过需要网络的测试
describe("Network-dependent tests", () => {
  it.skip("requires real API key", async () => {
    // 测试需要真实 LLM API 的场景
  });
});
```

### 2. 环境变量

```typescript
// Mock 环境变量
const mockEnv = {
  ANTHROPIC_API_KEY: "mock-key",
  OPENAI_API_KEY: "mock-key"
};

// 测试时使用 mock
process.env.ANTHROPIC_API_KEY = mockEnv.ANTHROPIC_API_KEY;
```

---

## 调试技巧

### 1. 日志和输出

```typescript
// 测试中的详细日志
import { describe, it, expect, console } from "vitest";

describe("Debug tests", () => {
  it("should log useful information", async () => {
    console.log("Test context:", { cwd: __dirname });
    console.log("Input data:", testData);
    
    const result = await operation();
    console.log("Result:", result);
  });
});
```

### 2. 断点调试

```bash
# 运行测试时启用调试模式
NODE_ENV=development npm test -- --reporter=verbose

# 或者在代码中添加 debugger
debugger;  // 在浏览器中暂停执行
```

---

## 核心优势

### 1. 无需 API Key

- 完全离线测试
- 快速反馈循环
- 节省 token 成本

### 2. 可靠的测试

- 单元测试隔离
- 集成测试真实场景
- Mock 工具覆盖边界情况

### 3. 持续集成

- Pre-commit hooks
- CI/CD 自动运行
- 覆盖率跟踪

---

## 关键源码文件

- `packages/ai/test/` - AI 包测试
- `packages/agent/test/` - Agent 包测试
- `packages/coding-agent/test/` - 编码 agent 测试
- `vitest.config.ts` - Vitest 配置
- `package.json` - 测试脚本

---

**快速扫描完成**！8/8 任务全部完成。

**进度总结**：
- ✅ #1 Extensions 系统 - 深度分析
- ✅ #2 会话管理 - 快速扫描
- ✅ #3 工具调用系统 - 快速扫描
- ✅ #4 Agent 运行时 - 快速扫描
- ✅ #5 TUI 终端 UI - 快速扫描
- ✅ #6 跨提供商切换 - 快速扫描
- ✅ #7 Skills 系统 - 快速扫描
- ✅ #8 测试策略 - 快速扫描
