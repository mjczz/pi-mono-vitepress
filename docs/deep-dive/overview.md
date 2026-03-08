# pi-mono 概览

## 1. 项目简介

pi-mono 是一个 AI 编程助手 monorepo，由 Mario Zechner (badlogic) 开发。

### 主要特性

- **"不内置"策略** - 让用户通过扩展塑造 pi，而不是被 pi 限制
- **类型安全** - 完整的 TypeScript 类型系统
- **可扩展** - 强大的扩展系统和 Skills 机制

## 2. 系统架构

```mermaid
graph TB
    subgraph UI["用户界面层"]
        TUI["TUI 终端"]
        WEB["Web UI<br/>(未来)"]
    end

    subgraph EXT["扩展层"]
        EXT_API["Extension API"]
        SKILLS["Skills 系统"]
    end

    subgraph CORE["核心层"]
        AGENT["Agent Core"]
        MOM["MoM<br/>多操作管理"]
    end

    subgraph LLM["LLM 抽象层"]
        AI["pi-ai"]
        ANTH["Anthropic"]
        OPEN["OpenAI"]
        GOOG["Google"]
    end

    TUI --> EXT_API
    WEB --> EXT_API
    EXT_API --> AGENT
    SKILLS --> AGENT
    AGENT --> MOM
    AGENT --> AI
    AI --> ANTH
    AI --> OPEN
    AI --> GOOG

    style TUI fill:#e1f5ff
    style AGENT fill:#f3e5f5
    style AI fill:#fce4ec
```

## 3. 包结构

```mermaid
graph LR
    ROOT["pi-mono"]
    PKG["packages/"]

    ROOT --> PKG

    PKG --> AI["pi-ai"]
    PKG --> AC["pi-agent-core"]
    PKG --> CA["pi-coding-agent"]
    PKG --> MOM["pi-mom"]
    PKG --> TUI["pi-tui"]
    PKG --> WEB["pi-web-ui"]
    PKG --> PODS["pi-pods"]

    style AI fill:#fce4ec
    style AC fill:#f3e5f5
    style TUI fill:#e1f5ff
```

### 包说明

| 包名 | 功能 |
|------|------|
| `pi-ai` | LLM API 抽象层，支持多家提供商 |
| `pi-agent-core` | Agent 核心逻辑 |
| `pi-coding-agent` | 编程助手实现 |
| `pi-mom` | 多操作管理器 |
| `pi-tui` | 终端 UI 框架 |
| `pi-web-ui` | Web UI（未来） |
| `pi-pods` | 容器化部署 |

## 4. 核心系统

```mermaid
mindmap
  root((pi-mono))
    Extensions
      20+ 事件类型
      工具注册
      命令注册
      UI 组件
    会话管理
      树形分支
      智能压缩
      持久化
    工具系统
      类型安全
      流式支持
      权限控制
    Agent 运行时
      事件驱动
      流式处理
      灵活队列
    TUI
      差分渲染
      组件化
      强大编辑器
    跨提供商
      透明切换
      格式转换
      Thinking 兼容
    Skills
      标准化格式
      模块化设计
      社区驱动
    测试
      离线测试
      Mock 机制
      CI/CD
```

## 5. 数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant T as TUI
    participant E as Extensions
    participant A as Agent
    participant L as LLM API
    participant M as LLM

    U->>T: 输入消息
    T->>E: on_input 事件
    E->>A: 发送消息
    A->>L: 调用流式 API
    L->>M: 发送请求
    M-->>L: 流式响应
    L-->>A: message_update 事件
    A->>E: on_message_update
    E->>T: 更新 UI
    T-->>U: 显示响应

    Note over A,M: 需要工具调用时
    A->>E: 调用工具
    E-->>A: 工具结果
    A->>L: 继续对话
```

## 6. 相关资源

- [GitHub 仓库](https://github.com/badlogic/pi-mono)
- [总索引](/deep-dive/pi-mono-study-index)
- [架构图](/deep-dive/pi-mono-architecture-diagram)
