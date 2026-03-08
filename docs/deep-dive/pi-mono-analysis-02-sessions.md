# pi-mono 会话管理快速扫描

**创建时间**: 2026-02-09 00:15 GMT+8
**任务编号**: #2
**类型**: 快速扫描概览

---

## 核心设计

### 会话文件格式 (JSONL)

会话以 **JSONL** (JSON Lines) 格式存储，每行一个 JSON 对象：

```jsonl
{"type": "session", "id": "abc123", "timestamp": "...", "cwd": "..."}
{"type": "message", "id": "def456", "parentId": "abc123", "timestamp": "...", "message": {...}}
{"type": "compaction", "id": "ghi789", "parentId": "xyz012", "timestamp": "...", "summary": "...", "firstKeptEntryId": "..."}
```

**关键特性**：
- 每条目都有 `id` 和 `parentId`，形成树形结构
- `id` 是 8 字符 hex 码（UUID 前 8 位）
- 支持分支：可以在任何点创建新分支，所有历史保留在**同一个文件**中

### 会话条目类型

```typescript
// 1. SessionHeader - 会话头部
interface SessionHeader {
  type: "session";
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;  // 当前版本：3
  parentSession?: string;  // 如果是从其他会话 fork 的
}

// 2. SessionMessageEntry - 消息条目
interface SessionMessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: AgentMessage;  // user/assistant/toolResult
}

// 3. CompactionEntry - 压缩条目
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;  // 扩展生成的
}

// 4. BranchSummaryEntry - 分支摘要
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string | null;
  timestamp: string;
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;  // 扩展生成的
}

// 5. LabelEntry - 标签条目
interface LabelEntry {
  type: "label";
  id: string;
  parentId: string | null;
  timestamp: string;
  targetId: string;
  label: string | undefined;
}

// 6. SessionInfoEntry - 会话信息
interface SessionInfoEntry {
  type: "session_info";
  id: string;
  parentId: string | null;
  timestamp: string;
  name?: string;  // 用户定义的显示名称
}

// 7. CustomEntry - 自定义条目（扩展用）
interface CustomEntry<T = unknown> {
  type: "custom";
  id: string;
  parentId: string | null;
  timestamp: string;
  customType: string;  // 扩展标识符
  data?: T;
}

// 8. ThinkingLevelChangeEntry - 思考级别变化
interface ThinkingLevelChangeEntry {
  type: "thinking_level_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  thinkingLevel: string;
}

// 9. ModelChangeEntry - 模型切换
interface ModelChangeEntry {
  type: "model_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  provider: string;
  modelId: string;
}
```

---

## 核心概念

### 1. 树形结构

每个会话文件是一个**树**：

```
Root (SessionHeader)
├─ Message (user)
│  └─ Message (assistant)
│      ├─ Message (user)
│      │  └─ Message (assistant)
│      │        ├─ BranchSummary (分支摘要)
│      │        ├─ Message (user)
│      │        │  └─ Message (assistant)
│      │        └─ Message (user)
│      │             └─ Message (assistant)
│      └─ Message (user)  ← 当前 leaf
```

**关键点**：
- `leafId` 指向当前活跃的条目
- 从 leaf 到 root 可以重建完整的对话历史
- 分支通过 `parentId` 连接，不需要创建新文件

### 2. /tree 命令

在树中导航，选择任意点继续：

- **功能**：浏览整个会话树
- **过滤模式**：default/no-tools/user-only/labeled-only/all
- **搜索**：按内容搜索条目
- **标签**：用户定义的书签标记
- **导航**：回车选择一个点，开始新的分支

**ASCII 可视化**：

```
├─ user: 开始分析 pi-mono
│  └─ assistant: 我来帮你分析
│     ├─ user: 先看看 extensions
│     │  └─ assistant: Extensions 是核心...
│     │
│     ├─ user: 然后是会话管理
│     │  └─ assistant: 会话管理负责...
│     │
│     └─ user: 好的
│        └─ assistant: 了解了！
│           ├─ [branch_summary] 切换到工具分析
│           └─ user: 看看工具调用
│              └─ [branch_summary] 切换到测试策略 ← 当前 leaf
```

### 3. /fork 命令

从任意点创建新会话文件：

- **功能**：复制历史到选定点
- **位置**：在 `.pi/agent/sessions/` 创建新文件
- **上下文**：新会话继承到该点的所有消息
- **UI**：选择器界面，可以选择要 fork 的点

### 4. 压缩 (Compaction)

当上下文接近限制时自动触发：

**流程**：
1. 检测到上下文即将溢出
2. 调用扩展的 `session_before_compact` 事件
3. 扩展可以：
   - 阻止压缩（`cancel: true`）
   - 自定义压缩（返回 `compaction` 结果）
   - 提供自定义摘要指令
4. 创建 `CompactionEntry` 条目
5. 保留旧消息在文件中（不删除）
6. LLM 只看到摘要和压缩后的消息

**扩展自定义压缩示例**：

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // 不压缩，只是减少最近的消息
  if (event.branchEntries.length < 10) {
    return { cancel: true };
  }

  // 自定义压缩：只保留最近 5 条
  return {
    compaction: {
      summary: "Retaining last 5 messages",
      firstKeptEntryId: event.branchEntries[event.branchEntries.length - 5].id,
      tokensBefore: event.preparation.currentTokens,
      fromExtension: true
    }
  };
});
```

---

## 迁移机制

### 版本演进

| 版本 | 变化 | 原因 |
|------|------|------|
| v1 | 无 id/parentId | 早期版本，线性结构 |
| v2 | 添加 id/parentId | 支持树形分支 |
| v3 | role: "hookMessage" → role: "custom" | 重命名，更清晰 |

### 自动迁移

会话加载时自动迁移到最新版本：

```typescript
function migrateToCurrentVersion(entries: FileEntry[]): boolean {
  const header = entries.find(e => e.type === "session");
  const version = header?.version ?? 1;

  if (version >= CURRENT_SESSION_VERSION) return false;

  if (version < 2) migrateV1ToV2(entries);  // 添加 id/parentId
  if (version < 3) migrateV2ToV3(entries);  // 重命名 role

  return true;
}
```

---

## 会话管理器 API

### SessionManager 类

```typescript
class SessionManager {
  // 基本操作
  cwd: string;
  sessionFile: string;
  leafId: string | null;

  // 追加条目
  appendMessage(message: Message | CustomMessage | BashExecutionMessage): string;
  appendThinkingLevelChange(thinkingLevel: string): string;
  appendModelChange(provider: string, modelId: string): string;
  appendCompaction(...): string;
  appendCustomEntry(customType: string, data?: unknown): string;
  appendSessionInfo(name: string): string;

  // 树操作
  getLeafId(): string | null;
  getLeafEntry(): SessionEntry | undefined;
  getEntry(id: string): SessionEntry | undefined;
  getChildren(parentId: string): SessionEntry[];
  getLabel(id: string): string | undefined;
  appendLabelChange(targetId: string, label: string | undefined): string;

  // 查询
  getEntry(id: string): SessionEntry | undefined;
  getEntries(): SessionEntry[];
  getTree(): SessionTreeNode[];
  getBranch(entryId: string): SessionEntry[];

  // 上下文构建
  buildSessionContext(leafId?: string | null): SessionContext;
}
```

### 会话上下文

```typescript
interface SessionContext {
  messages: AgentMessage[];  // 发送到 LLM 的消息
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}
```

`buildSessionContext` 从 leaf 遍历到 root，智能处理：
- CompactionEntry → 先发送摘要
- BranchSummaryEntry → 作为消息发送
- CustomMessageEntry → 转换为用户消息发送
- LabelEntry → 忽略（不参与 LLM 上下文）

---

## 核心优势

### 1. 单文件持久化
- **不需要**每个分支创建新文件
- **所有历史**保留在一个文件中
- **易于管理**：一个项目 = 一个会话文件（或多个会话）

### 2. 精确的分支点
- 可以在任何消息处分支
- 分支摘要清晰标记分支点
- 便于实验和回滚

### 3. 灵活的压缩
- 扩展可以完全自定义压缩策略
- 不只是简单的摘要，可以保留/丢弃特定条目
- 支持结构化压缩（用于 artifact 索引等）

### 4. 标签系统
- 用户定义的书签
- 方便导航到重要点
- 不参与 LLM 上下文

### 5. 版本兼容
- 自动迁移旧会话
- 向后兼容
- 不丢失历史

---

## 实际使用场景

### 场景 1：实验不同代码方案

```bash
# 1. 开发到某个点
pi "实现 feature A"
# 2. 分支，尝试方案 B
/tree  # 选择 feature A 之前的点
/fork  # 创建新会话
pi "实现 feature B"
# 3. 如果不喜欢，切换回 A
/tree  # 回到主分支
```

### 场景 2：长期对话压缩

```
Session 文件 (1000+ 条目)
    ↓
自动压缩触发
    ↓
CompactionEntry (summary: "保留了最近 50 条消息")
    ↓
LLM 只看到摘要 + 最近 50 条
    ↓
完整历史保留在文件中
    ↓
/tree 可以查看所有历史
```

### 场景 3：扩展自定义压缩

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  // 自定义：按项目文件分组压缩
  const projectFiles = groupByProject(event.branchEntries);
  return {
    compaction: {
      summary: formatCompactionSummary(projectFiles),
      firstKeptEntryId: findRecentImportantEntry(projectFiles),
      tokensBefore: event.preparation.currentTokens,
      fromExtension: true,
      details: { projectFiles }
    }
  };
});
```

---

## 关键源码文件

- `packages/coding-agent/src/core/session-manager.ts` - 会话管理核心（1000+ 行）
- `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` - 树形导航 UI（1000+ 行）

---

**下一步**: 深度分析会话管理（树形算法、压缩策略、UI 实现细节）
