# pi-mono Skills 系统深度分析

**创建时间**: 2026-02-09 07:37 GMT+8
**任务编号**: #7
**类型**: 深度分析
**分析文件**: 
- `packages/coding-agent/src/core/skills/` - Skills 系统实现
- `packages/coding-agent/src/core/skills/parser.ts` - 技能解析器
- `packages/coding-agent/src/core/skills/loader.ts` - 技能加载器
- `packages/coding-agent/src/core/skills/index.ts` - Skills 系统入口

---

## 目录

1. [Agent Skills 标准](#agent-skills-标准)
2. [SKILL.md 格式](#skillmd-格式)
3. [技能解析器](#技能解析器)
4. [技能加载机制](#技能加载机制)
5. [/skill 命令实现](#skill-命令实现)
6. [技能注入到上下文](#技能注入到上下文)
7. [工具提取和注册](#工具提取和注册)
8. [实际技能示例](#实际技能示例)
9. [最佳实践](#最佳实践)

---

## Agent Skills 标准

### 核心概念

**Agent Skills** 是一个社区驱动的 AI Agent 技能标准，定义了可复用的提示词、工具和配置的标准格式。

**设计理念**：
- **Markdown 格式** - 易于读写和版本控制
- **模块化** - 每个技能是独立的文件
- **可组合** - 多个技能可以一起使用
- **类型安全** - 支持 TypeBox 参数定义

### 标准结构

```markdown
# Skill Name

Use this skill when user asks about X.

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

### 必需部分

1. **标题**（`# Skill Name`）- 技能名称，简短描述
2. **使用场景** - "Use this skill when..."
3. **步骤**（`## Steps`）- 详细的执行步骤
4. **工具**（`## Tools`）- 技能使用的工具列表

### 可选部分

- **工具定义** - 在 Skills 文件中直接定义工具
- **提示词** - 额外的系统提示词片段
- **环境变量** - 技能特定的配置
- **依赖** - 技能之间的依赖关系

---

## SKILL.md 格式

### 完整示例

```markdown
# Code Review

Use this skill when user asks for code review, suggestions, or improvements.

## Steps

1. Read the files mentioned
2. Check for common issues:
   - Security vulnerabilities (injections, unsafe evals)
   - Performance problems (inefficient loops, memory leaks)
   - Code style violations (naming, formatting, comments)
   - Bug patterns (off-by-one, null pointer dereferences)
3. Provide specific feedback with examples
4. Suggest refactoring opportunities
5. Highlight positive aspects

## Tools

Tool 1: read
Tool 2: grep
Tool 3: find
```

### 类型化工具定义

```markdown
# Database Backup

Use this skill when user needs to backup or restore a database.

## Steps

1. Check database type from config
2. Verify database is running
3. Create backup directory
4. Dump database to file
5. Verify backup integrity
6. Compress backup if needed

## Tools

Tool 1: bash
```

```typescript
// 工具定义（在技能文件中或单独定义）
interface BashToolDefinition {
  name: "bash";
  label: "Bash";
  description: "Execute shell commands";
  parameters: Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" }))
  });
}
```

---

## 技能解析器

### 解析流程

```typescript
// packages/coding-agent/src/core/skills/parser.ts

export interface SkillSection {
  name?: string;              // 标题（从 # heading）
  type?: string;               // 类型（可选）
  content: string;            // Markdown 内容
  startLine: number;          // 在文件中的起始行
  endLine: number;            // 在文件中的结束行
}

export function parseSkillFile(content: string): SkillSection[] {
  const sections: SkillSection[] = [];
  const lines = content.split('\n');
  
  let currentSection: SkillSection | null = null;
  let sectionContent: string[] = [];
  let startLine = 0;
  
  // 解析每一行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const trimmedLine = lines[i].trimEnd();
    
    // 1. 检测标题（# Heading）
    if (trimmedLine.startsWith('#')) {
      // 保存上一节
      if (currentSection) {
        currentSection.content = sectionContent.join('\n');
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }
      
      // 开始新节
      const name = trimmedLine.slice(1).trim();
      currentSection = {
        name,
        content: '',
        startLine: i,
        endLine: i
      };
      sectionContent = [trimmedLine];
      startLine = i;
    }
    // 2. 普通行
    else if (currentSection) {
      sectionContent.push(lines[i]);
    }
  }
  
  // 保存最后一节
  if (currentSection) {
    currentSection.content = sectionContent.join('\n');
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }
  
  return sections;
}
```

### 节类型识别

```typescript
function identifySectionType(section: SkillSection): SkillSectionType {
  const name = section.name?.toLowerCase() || '';
  const content = section.content.toLowerCase();
  
  if (name.includes('steps')) {
    return 'steps';
  } else if (name.includes('tools')) {
    return 'tools';
  } else if (name.includes('notes')) {
    return 'notes';
  } else if (name.includes('system')) {
    return 'system';
  } else if (name.includes('prompt')) {
    return 'prompt';
  } else {
    return 'description';
  }
}

type SkillSectionType = 'steps' | 'tools' | 'notes' | 'system' | 'prompt' | 'description';
```

---

## 技能加载机制

### 发现路径

```typescript
// packages/coding-agent/src/core/skills/loader.ts

interface SkillDiscoveryOptions {
  cwd: string;
  agentDir: string;
  configuredPaths: string[];
  eventBus?: EventBus;
}

async function discoverSkills(
  options: SkillDiscoveryOptions
): Promise<SkillSection[]> {
  const { cwd, agentDir, configuredPaths, eventBus } = options;
  const allPaths: string[] = [];
  
  // 1. 全局技能目录
  const globalSkillsDir = path.join(agentDir, 'skills');
  allPaths.push(...discoverSkillsInDir(globalSkillsDir));
  
  // 2. 项目技能目录
  const localSkillsDir = path.join(cwd, '.pi', 'skills');
  allPaths.push(...discoverSkillsInDir(localSkillsDir));
  
  // 3. 显式配置的路径
  for (const skillPath of configuredPaths) {
    const resolved = resolvePath(skillPath, cwd);
    
    if (fs.existsSync(resolved)) {
      // 检查是否是目录
      const stat = await fs.stat(resolved);
      
      if (stat.isDirectory()) {
        // 查找目录中的 SKILL.md 文件
        const skillFile = path.join(resolved, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          allPaths.push(skillFile);
        }
        // 查找所有 .md 文件
        const mdFiles = await findMarkdownFiles(resolved);
        allPaths.push(...mdFiles);
      } else if (stat.isFile() && resolved.endsWith('.md')) {
        allPaths.push(resolved);
      }
    }
  }
  
  // 4. 触发发现事件
  if (eventBus) {
    eventBus.emit('skills_discovered', {
      type: 'resources_discover',
      cwd,
      reason: 'load',
      skillPaths: allPaths
    });
  }
  
  // 5. 加载所有技能
  const allSections: SkillSection[] = [];
  
  for (const skillPath of allPaths) {
    const content = await fs.readFile(skillPath, 'utf-8');
    const sections = parseSkillFile(content);
    
    allSections.push(...sections);
  }
  
  return allSections;
}
```

### 技能文件解析

```typescript
async function loadSkillFile(
  skillPath: string,
  eventBus?: EventBus
): Promise<SkillSection[]> {
  try {
    // 1. 读取文件
    const content = await fs.readFile(skillPath, 'utf-8');
    
    // 2. 解析技能节
    const sections = parseSkillFile(content);
    
    // 3. 触发加载事件
    if (eventBus) {
      eventBus.emit('skill_loaded', {
        type: 'resources_load',
        skillPath,
        sections
      });
    }
    
    return sections;
  } catch (error) {
    // 4. 错误处理
    if (eventBus) {
      eventBus.emit('skill_error', {
        type: 'resources_error',
        skillPath,
        error: error.message
      });
    }
    
    return [];
  }
}
```

---

## /skill 命令实现

### 命令注册

```typescript
// packages/coding-agent/src/core/skills/index.ts

export function registerSkillCommands(pi: ExtensionAPI): void {
  // 1. /skill - 使用指定技能
  pi.registerCommand('skill', {
    description: 'Use a specific skill',
    getArgumentCompletions: (prefix) => {
      const availableSkills = pi.getAvailableSkills();
      const filtered = availableSkills.filter(s => 
        s.name.toLowerCase().startsWith(prefix.toLowerCase())
      );
      return filtered.length > 0 
        ? filtered.map(s => ({ value: s.name, label: s.name }))
        : null;
    },
    handler: async (skillName, ctx) => {
      await useSkill(skillName, ctx);
    }
  });
  
  // 2. /skills - 列出所有可用技能
  pi.registerCommand('skills', {
    description: 'List all available skills',
    handler: async (_args, ctx) => {
      const skills = pi.getAvailableSkills();
      
      if (skills.length === 0) {
        ctx.ui.notify('No skills available', 'info');
        return;
      }
      
      // 显示技能列表
      const selected = await ctx.ui.select(
        'Available Skills',
        skills.map(s => `${s.name} - ${s.description}`)
      );
      
      if (selected) {
        const skillName = selected.split(' - ')[0];
        await useSkill(skillName, ctx);
      }
    }
  });
}
```

### 技能使用逻辑

```typescript
async function useSkill(
  skillName: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  // 1. 获取技能定义
  const skill = await getSkillByName(skillName);
  
  if (!skill) {
    ctx.ui.notify(`Skill not found: ${skillName}`, 'error');
    return;
  }
  
  // 2. 确认使用
  const confirmed = await ctx.ui.confirm(
    `Use ${skillName}`,
    `${skill.description}\n\nLoad this skill?`
  );
  
  if (!confirmed) {
    return;
  }
  
  // 3. 等待 Agent 空闲
  if (!ctx.isIdle()) {
    await ctx.ui.notify('Agent is busy, waiting...', 'warning');
    await ctx.waitForIdle();
  }
  
  // 4. 构建技能提示词
  const skillPrompt = buildSkillPrompt(skill);
  
  // 5. 注入技能提示词
  pi.sendMessage({
    customType: 'skill-injection',
    content: `Using skill: ${skillName}`,
    display: true,
    details: { skillName, skillPrompt }
  });
  
  // 6. 设置系统提示词
  const systemPrompt = pi.getSystemPrompt();
  const updatedPrompt = `${systemPrompt}\n\n${skillPrompt}`;
  pi.setSystemPrompt(updatedPrompt);
}
```

---

## 技能注入到上下文

### 提示词构建

```typescript
function buildSkillPrompt(skill: Skill): string {
  let prompt = '';
  
  // 1. 使用场景
  if (skill.usage) {
    prompt += `${skill.usage}\n\n`;
  }
  
  // 2. 步骤
  const stepsSection = skill.sections.find(s => 
    s.name?.toLowerCase() === 'steps'
  );
  
  if (stepsSection) {
    prompt += `Steps:\n${stepsSection.content}\n\n`;
  }
  
  // 3. 工具说明
  const toolsSection = skill.sections.find(s => 
    s.name?.toLowerCase() === 'tools'
  );
  
  if (toolsSection) {
    prompt += `Tools:\n${toolsSection.content}\n\n`;
  }
  
  // 4. 注意事项
  const notesSection = skill.sections.find(s => 
    s.name?.toLowerCase() === 'notes'
  );
  
  if (notesSection) {
    prompt += `Notes:\n${notesSection.content}\n\n`;
  }
  
  return prompt.trim();
}
```

### 上下文注入策略

```typescript
// 通过 CustomMessageEntry 注入到 LLM 上下文
async function injectSkillToContext(
  skillName: string,
  skill: Skill,
  ctx: ExtensionCommandContext
): Promise<void> {
  // 1. 构建 skill prompt
  const skillPrompt = buildSkillPrompt(skill);
  
  // 2. 添加自定义消息条目
  // 注意：这会话添加到上下文，但不显示（display: false）
  pi.appendCustomMessageEntry(
    'skill-prompt',
    {
      type: 'text',
      text: skillPrompt
    },
    false  // 不显示在 UI 中，只发送给 LLM
  );
  
  // 3. 添加自定义条目用于追踪（可选）
  pi.appendEntry('skill-usage', {
    skillName,
    timestamp: new Date().toISOString(),
    applied: true
  });
  
  // 4. 注册技能提供的工具
  const toolDefinitions = extractToolDefinitions(skill);
  for (const tool of toolDefinitions) {
    pi.registerTool(tool);
  }
}
```

---

## 工具提取和注册

### 从技能中提取工具

```typescript
function extractToolDefinitions(skill: Skill): AgentTool[] {
  const tools: AgentTool[] = [];
  
  // 1. 查找工具定义节
  const toolsSection = skill.sections.find(s => 
    s.name?.toLowerCase() === 'tools'
  );
  
  if (!toolsSection) {
    return tools;
  }
  
  // 2. 解析工具定义
  const toolDefinitions = parseToolDefinitions(toolsSection.content);
  
  // 3. 转换为 AgentTool
  for (const def of toolDefinitions) {
    const tool = {
      name: def.name,
      label: def.label || def.name,
      description: def.description,
      parameters: def.parameters,  // TypeBox 模式
      
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        // 技能特定的工具执行逻辑
        return await executeSkillTool(
          skill.name,
          def.name,
          params,
          signal,
          onUpdate,
          ctx
        );
      }
    } as AgentTool;
    
    tools.push(tool);
  }
  
  return tools;
}
```

### 技能工具执行

```typescript
async function executeSkillTool(
  skillName: string,
  toolName: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  ctx: ExtensionContext
): Promise<AgentToolResult> {
  // 1. 发送开始通知
  onUpdate?.({
    content: [{ type: 'text', text: `Executing ${skillName}:${toolName}...` }],
    details: { skill: skillName, tool: toolName, progress: 0 }
  });
  
  try {
    // 2. 执行技能特定的工具逻辑
    const result = await executeToolLogic(
      skillName,
      toolName,
      params,
      signal,
      onUpdate,
      ctx
    );
    
    // 3. 发送完成通知
    onUpdate?.({
      content: [{ type: 'text', text: `Complete: ${result.summary}` }],
      details: { skill: skillName, tool: toolName, progress: 100, result }
    });
    
    return {
      content: [{ type: 'text', text: result.summary }],
      details: { skill: skillName, tool: toolName, result }
    };
  } catch (error) {
    // 4. 错误处理
    onUpdate?.({
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      details: { skill: skillName, tool: toolName, error: error.message, progress: 0, isError: true }
    });
    
    throw error;
  }
}
```

---

## 实际技能示例

### 示例 1: 代码审查技能

```markdown
# Code Review

Use this skill when user asks for code review, suggestions, or improvements.

## Steps

1. Read the files mentioned
2. Check for common issues:
   - Security vulnerabilities (injections, unsafe evals, hardcoded credentials)
   - Performance problems (inefficient algorithms, memory leaks, unnecessary computations)
   - Code style violations (naming conventions, formatting, comments)
   - Bug patterns (off-by-one, null pointer dereferences, race conditions)
3. Provide specific feedback with examples
4. Suggest refactoring opportunities
5. Highlight positive aspects and best practices

## Tools

Tool 1: read
Tool 2: grep
Tool 3: find

## Notes

- Always review the entire file context, not just the changed lines
- Consider the project's coding standards and conventions
- Be constructive and provide actionable feedback
- Highlight security issues as critical priority
```

### 示例 2: 测试策略技能

```markdown
# Testing Strategy

Use this skill when user asks about testing approach, test coverage, or test design.

## Steps

1. Analyze the codebase structure and architecture
2. Identify key areas requiring tests:
   - Business logic (pure functions, algorithms)
   - External dependencies (API calls, database interactions)
   - UI components (user interactions, edge cases)
   - Performance-critical paths
3. Propose testing strategy:
   - Unit tests for isolated functions
   - Integration tests for external dependencies
   - End-to-end tests for user workflows
   - Performance tests for critical paths
4. Suggest testing frameworks and tools
5. Provide test organization structure

## Tools

Tool 1: find
Tool 2: ls
Tool 3: read

## Notes

- Start with unit tests for pure functions
- Mock external dependencies for reliability
- Use descriptive test names that explain what and why
- Aim for high coverage of critical paths
- Regular tests should be fast (< 100ms)
- Integration tests should be realistic but not fragile
```

### 示例 3: 数据库迁移技能

```markdown
# Database Migration

Use this skill when user needs to migrate database schema or data.

## Steps

1. Analyze current schema
2. Design new schema
3. Create migration script
4. Backup existing data
5. Test migration on copy
6. Execute migration
7. Verify data integrity
8. Update application configuration

## Tools

Tool 1: bash
Tool 2: read
Tool 3: write
```

---

## 最佳实践

### 1. 技能设计

#### ✅ DO

- **保持技能专注** - 每个技能解决一个明确的问题
- **提供清晰的使用场景** - "Use this skill when..."
- **包含详细的步骤** - 确保可重复执行
- **列出所需工具** - 明确指定需要的工具

#### ❌ DON'T

- **不要创建过于宽泛的技能** - "General Programming" 太模糊
- **不要省略步骤** - 用户应该知道如何使用
- **不要忽略工具** - 列出所有需要的工具
- **不要假设环境** - 技能应该适应不同的项目结构

### 2. 技能文件组织

#### ✅ DO

- **使用标准文件名** - `SKILL.md` 或描述性名称
- **保持文件小** - 单个技能文件 < 5KB
- **使用子目录** - 相关技能放在一起
- **版本控制友好** - 易于追踪变化

#### ❌ DON'T

- **不要在一个文件中放多个技能** - 每个技能应该是独立的
- **不要使用复杂的嵌套** - 保持结构扁平
- **不要省略元数据** - 使用描述性的标题

### 3. 工具集成

#### ✅ DO

- **在技能中定义工具** - 如果是技能特定的工具
- **使用 TypeBox** - 提供完整的类型定义
- **提供示例** - 工具使用示例

#### ❌ DON'T

- **不要硬编码工具逻辑** - 应该可复用
- **不要忽略错误处理** - 工具调用失败应该有清晰的错误消息
- **不要绕过验证** - 工具参数应该验证

### 4. 提示词工程

#### ✅ DO

- **使用清晰的语言** - 避免歧义
- **提供示例** - 展示期望的输出格式
- **设置明确的约束** - 如果有特定的要求

#### ❌ DON'T

- **不要使用模糊的指令** - "be helpful" 太抽象
- **不要过度约束** - 允许 LLM 发挥创造力
- **不要忽略上下文** - 技能提示词应该与当前上下文协调

### 5. 测试技能

#### ✅ DO

- **测试技能加载** - 确保技能文件可以正确解析
- **测试技能提示词** - 验证 LLM 理解正确
- **测试工具集成** - 确保工具可以正确执行
- **测试错误处理** - 验证失败情况处理正确

#### ❌ DON'T

- **不要假设技能文件格式** - 技能文件可能来自不同来源
- **不要忽略边界情况** - 空文件、损坏文件、错误格式
- **不要忽略性能** - 技能加载应该快速

---

## 核心优势

### 1. 社区驱动标准

- **统一的格式** - 所有技能遵循相同的标准
- **易于分享** - 技能可以跨项目分享
- **版本控制友好** - Markdown 格式易于追踪

### 2. 模块化设计

- **独立文件** - 每个技能是独立的 Markdown 文件
- **灵活的发现** - 支持全局、项目、显式路径
- **组合使用** - 多个技能可以一起使用

### 3. 类型安全

- **TypeBox 工具定义** - 完整的类型支持
- **参数验证** - 工具参数自动验证
- **IDE 支持** - TypeScript 提供智能提示

### 4. 灵活的执行

- **注入机制** - 技能提示词可以注入到系统提示词
- **工具注册** - 技能可以注册自定义工具
- **上下文感知** - 技能可以访问当前上下文

### 5. 易于扩展

- **自定义技能** - 可以创建特定领域的技能
- **技能链** - 一个技能可以调用另一个技能
- **动态加载** - 技能可以在运行时加载

---

## 关键源码文件

- `packages/coding-agent/src/core/skills/` - Skills 系统实现
- `packages/coding-agent/src/core/skills/parser.ts` - 技能解析器（200+ 行）
- `packages/coding-agent/src/core/skills/loader.ts` - 技能加载器（300+ 行）
- `packages/coding-agent/src/core/skills/index.ts` - Skills 系统入口
- `packages/coding-agent/examples/skills/` - 技能示例

---

**下一步**: 深度分析 #8 测试策略
