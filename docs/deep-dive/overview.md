# pi-mono 概览

## 1. 项目简介

pi-mono 是一个 AI 编程助手 monorepo，由 Mario Zechner (badlogic) 开发。

### 主要特性

- **"不内置"策略** - 让用户通过扩展塑造 pi，而不是被 pi 限制
- **类型安全** - 完整的 TypeScript 类型系统
- **可扩展** - 强大的扩展系统和 Skills 机制

## 2. 包结构

```
packages/
├── pi-ai/              # LLM API 抽象层
├── pi-agent-core/      # Agent 核心逻辑
├── pi-coding-agent/   # 编程助手实现
├── pi-mom/            # 多操作管理器
├── pi-tui/             # 终端 UI 框架
├── pi-web-ui/         # Web UI（未来）
└── pi-pods/            # 容器化部署
```

## 3. 核心系统

- **Extensions 系统** - 20+ 事件类型，完整 UI 能力
- **会话管理** - 树形分支，智能压缩
- **工具调用系统** - 类型安全，流式支持
- **Agent 运行时** - 事件驱动，灵活队列
- **TUI 终端 UI** - 差分渲染，强大编辑器
- **跨提供商切换** - 透明抽象，完整兼容
- **Skills 系统** - 标准化格式，社区驱动
- **测试策略** - 完全离线，CI/CD 集成

## 4. 相关资源

- [GitHub 仓库](https://github.com/badlogic/pi-mono)
- [总索引](/deep-dive/pi-mono-study-index)
