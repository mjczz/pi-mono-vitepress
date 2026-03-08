---
layout: home

hero:
  name: "pi-mono 深度分析"
  text: "深入理解 pi-mono 核心机制与源码实现"
  tagline: "极简核心 + 极致扩展 —— 探索 AI 编程助手的设计哲学"
  actions:
    - theme: brand
      text: 阅读总索引
      link: /deep-dive/pi-mono-study-index
    - theme: alt
      text: 查看源码
      link: https://github.com/badlogic/pi-mono

features:
  - icon: 🔌
    title: Extensions 系统
    details: 20+ 事件类型、完整 UI 能力、类型安全、运行时隔离
  - icon: 🌳
    title: 会话管理
    details: 树形分支、智能压缩、单文件持久化、版本兼容
  - icon: 🔧
    title: 工具调用系统
    details: 类型安全、流式支持、权限控制、可扩展
  - icon: ⚡
    title: Agent 运行时
    details: 事件驱动、流式消息处理、灵活队列、强大 Abort
  - icon: 🖥️
    title: TUI 终端 UI
    details: 差分渲染、组件化设计、强大编辑器、完整快捷键
  - icon: 🔄
    title: 跨提供商切换
    details: 提供商无关、透明切换、消息格式转换、Thinking 兼容
  - icon: 📚
    title: Skills 系统
    details: 标准化格式、模块化设计、灵活发现、社区驱动
  - icon: 🧪
    title: 测试策略
    details: 无需 API Key、Mock LLM 机制、CI/CD 支持、高覆盖率
---

## pi-mono 项目概述

**pi-mono** 是一个由 Mario Zechner (badlogic) 开发的 AI 编程助手 monorepo。

### 核心设计哲学：**"不内置"策略**

很多竞品内置的功能，pi 选择不内置，让用户通过扩展塑造 pi，而不是被 pi 限制：

| 竞品功能 | pi 选择 |
|----------|---------|
| MCP | ❌ 不内置 |
| 子代理 | ❌ 不内置 |
| 权限弹窗 | ❌ 不内置 |
| 计划模式 | ❌ 不内置 |
| 内置 TODOs | ❌ 不内置 |

### 包结构

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

### 分析内容

本文档集合包含 **8 个核心系统** 的深度分析：

- **Extensions 系统** - 34K 快速扫描
- **会话管理** - 75K 快速扫描 + 24K 深度分析
- **工具调用系统** - 76K 快速扫描 + 26K 深度分析
- **Agent 运行时** - 55K 快速扫描 + 23K 深度分析
- **TUI 终端 UI** - 73K 快速扫描 + 24K 深度分析
- **跨提供商切换** - 70K 快速扫描 + 20K 深度分析
- **Skills 系统** - 38K 快速扫描 + 17K 深度分析
- **测试策略** - 92K 快速扫描 + 25K 深度分析

**总计**: 约 697K 字符，15 个分析文档
