# pi-mono 项目结构分析

## 1. 目录结构

```mermaid
graph TD
    ROOT["pi-mono/"]
    PKG["packages/"]
    TST["tests/"]
    PKG_JSON["package.json"]

    ROOT --> PKG
    ROOT --> TST
    ROOT --> PKG_JSON

    PKG --> AI["pi-ai/"]
    PKG --> CORE["pi-agent-core/"]
    PKG --> CODE["pi-coding-agent/"]
    PKG --> MOM["pi-mom/"]
    PKG --> TUI["pi-tui/"]
    PKG --> WEB["pi-web-ui/"]
    PKG --> PODS["pi-pods/"]

    AI --> AI_SRC["src/"]
    AI --> AI_PKG["package.json"]

    style ROOT fill:#f5f5f5
    style AI fill:#fce4ec
    style CORE fill:#f3e5f5
    style TUI fill:#e1f5ff
```

## 2. 核心模块说明

### pi-ai

```mermaid
classDiagram
    class pi-ai {
        +ModelRegistry
        +AnthropicProvider
        +OpenAIProvider
        +GoogleProvider
        +StreamAPI
        +MessagesAPI
    }

    class ModelRegistry {
        +registerModel()
        +getModel()
        +listModels()
    }

    class StreamAPI {
        +stream()
        +abort()
    }

    pi-ai --> ModelRegistry
    pi-ai --> StreamAPI
```

LLM API 抽象层，支持多家提供商：
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- xAI (Grok)

### pi-agent-core

```mermaid
classDiagram
    class AgentCore {
        +Agent
        +AgentLoop
        +ToolExecutor
        +StateManager
        +QueueManager
    }

    class Agent {
        +start()
        +abort()
        +sendMessage()
    }

    class QueueManager {
        +steeringQueue
        +followUpQueue
        +process()
    }

    AgentCore --> Agent
    AgentCore --> QueueManager
```

Agent 核心逻辑：
- 事件驱动架构
- 流式消息处理
- 灵活的队列机制

### pi-tui

```mermaid
classDiagram
    class TUI {
        +Renderer
        +Component
        +Editor
        +Theme
    }

    class Renderer {
        +render()
        +diff()
        +draw()
    }

    class Component {
        +Text()
        +Container()
        +Input()
    }

    TUI --> Renderer
    TUI --> Component
```

终端 UI 框架：
- 差分渲染
- 组件化设计
- 强大编辑器

## 3. 模块依赖关系

```mermaid
graph LR
    TUI["pi-tui"]
    CODE["pi-coding-agent"]
    CORE["pi-agent-core"]
    AI["pi-ai"]
    MOM["pi-mom"]

    TUI --> CORE
    CODE --> CORE
    CODE --> AI
    CORE --> AI
    CORE --> MOM

    style AI fill:#fce4ec
    style CORE fill:#f3e5f5
    style TUI fill:#e1f5ff
```

## 4. 相关资源

- [总索引](/deep-dive/pi-mono-study-index)
- [GitHub](https://github.com/badlogic/pi-mono)
