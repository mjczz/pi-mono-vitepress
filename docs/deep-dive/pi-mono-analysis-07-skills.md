# pi-mono Skills 系统快速扫描

**创建时间**: 2026-02-09 06:38 GMT+8
**任务编号**: #7
**类型**: 快速扫描概览

---

## 核心概念

### Agent Skills 标准

Skills 是遵循 **Agent Skills 标准规范的 Markdown 文件**，提供可复用的提示词和工具组合。

**标准格式**：

```markdown
# Skill Name

Use this skill when the user asks about X.

## Steps

1. Do this
2. Then that
3. Finally that

## Tools

Tool 1: description
Tool 2: description

## Notes

- Important notes
- Context-specific tips
```

### 技能加载机制

```typescript
// 发现路径（优先级）
~/.pi/agent/skills/        // 全局技能
.pi/skills/                   // 项目技能
-extensions/skills/           // Pi 包中的技能
~/.pi/skills/                 // 旧路径（兼容）

// 加载时机
- 会话启动时（session_start）
- 扩展发现时（resources_discover）
- 手动 /reload 命令

// 技能命令
/skill:<name>  // 加载并使用特定技能
```

---

## pi-mono 中的实现

### 1. 技能解析器

```typescript
// packages/coding-agent/src/core/skills/parser.ts

interface SkillSection {
  name?: string;           // # 标题
  type?: string;            // 类型（可选）
  content: string;          // Markdown 内容
  startLine: number;       // 在文件中的起始行
  endLine: number;         // 在文件中的结束行
}

// 解析 SKILL.md 文件为多个部分
function parseSkillFile(content: string): SkillSection[]
```

### 2. 技能加载器

```typescript
// packages/coding-agent/src/core/skills/loader.ts

// 加载技能文件
async function loadSkillFile(
  skillPath: string,
  eventBus: EventBus
): Promise<SkillSection[]>

// 发现技能目录
async function discoverSkills(
  cwd: string,
  agentDir: string,
  eventBus: EventBus
): Promise<SkillSection[]>
```

### 3. 技能命令

```typescript
// /skill:<name> 命令实现

// 1. 查找技能
const skill = findSkillByName(skillName);

// 2. 解析为部分
const sections = parseSkillFile(skill.content);

// 3. 添加到上下文
const systemPrompt = buildSkillPrompt(sections);

// 4. 注入到系统提示词
agent.setSystemPrompt(basePrompt + "\n\n" + systemPrompt);

// 5. 设置上下文消息
agent.appendCustomMessage("skill", {
  customType: skill.name,
  content: systemPrompt,
  display: true,
  details: { sections }
});
```

### 4. 技能上下文构建

```typescript
// 构建技能提示词
function buildSkillPrompt(sections: SkillSection[]): string {
  let prompt = "";

  for (const section of sections) {
    if (section.name) {
      prompt += `## ${section.name}\n`;
    }
    prompt += `${section.content}\n\n`;
  }

  return prompt;
}

// 技能中定义的工具会自动注册
function extractToolsFromSkill(sections: SkillSection[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const section of sections) {
    // 解析 ```typescript ... ``` 中的工具定义
    // 支持标准 Agent Skills 工具语法
  }

  return tools;
}
```

---

## 技能示例

### 示例 1: 代码审查

```markdown
# Code Review

Use this skill when the user asks for code review.

## Steps

1. Read the files mentioned
2. Check for common issues:
   - Security vulnerabilities
   - Performance problems
   - Code style violations
   - Bug patterns
3. Provide specific feedback with examples

## Tools

Tool 1: grep
Tool 2: read
Tool 3: write
```

### 示例 2: 测试策略

```markdown
# Test Strategy

Use this skill when the user asks about testing approach.

## Steps

1. Analyze the codebase structure
2. Identify key areas requiring tests
3. Propose testing strategy:
   - Unit tests for pure functions
   - Integration tests for external dependencies
   - E2E tests for user workflows
4. Provide testing framework recommendations

## Tools

Tool 1: find
Tool 2: ls
```

---

## 优势

### 1. 标准化
- 遵循 Agent Skills 标准
- 跨项目兼容
- 社区共享

### 2. 灵活性
- Markdown 格式易于编辑
- 模块化设计
- 可组合使用

### 3. 集成
- 自动发现和加载
- 与 Extensions 系统集成
- 支持工具定义提取

### 4. 可维护性
- 独立技能文件
- 版本控制友好
- 易于测试

---

## 限制

### 1. 工具集成
- 技能中的工具需要手动注册到 Agent
- 类型推断有限制

### 2. 上下文管理
- 技能注入会占用上下文窗口
- 需要合理的技能大小

### 3. 冲突处理
- 多个技能可能定义相同的工具
- 需要明确的优先级规则

---

## 关键源码文件

- `packages/coding-agent/src/core/skills/parser.ts` - 技能解析器
- `packages/coding-agent/src/core/skills/loader.ts` - 技能加载器
- `packages/coding-agent/src/core/skills/index.ts` - 技能系统入口
- `packages/coding-agent/examples/skills/` - 技能示例

---

**下一步**: 测试策略（最后一个快速扫描任务）
