# pi-mono 项目结构分析

## 1. 目录结构

```
pi-mono/
├── packages/
│   ├── pi-ai/              # LLM API 抽象层
│   ├── pi-agent-core/      # Agent 核心逻辑
│   ├── pi-coding-agent/   # 编程助手实现
│   ├── pi-mom/            # 多操作管理器
│   ├── pi-tui/             # 终端 UI 框架
│   ├── pi-web-ui/         # Web UI（未来）
│   └── pi-pods/            # 容器化部署
├── tests/                  # 测试目录
└── package.json           # 项目配置
```

## 2. 核心模块说明

### pi-ai
LLM API 抽象层，支持多家提供商：
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- xAI (Grok)

### pi-agent-core
Agent 核心逻辑：
- 事件驱动架构
- 流式消息处理
- 灵活的队列机制

### pi-tui
终端 UI 框架：
- 差分渲染
- 组件化设计
- 强大编辑器

## 3. 相关资源

- [总索引](/deep-dive/pi-mono-study-index)
- [GitHub](https://github.com/badlogic/pi-mono)
