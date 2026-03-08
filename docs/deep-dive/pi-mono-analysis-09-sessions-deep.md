# pi-mono 会话管理系统深度分析

**创建时间**: 2026-02-09 06:39 GMT+8
**任务编号**: #2
**类型**: 深度分析
**分析文件**: 
- `session-manager.ts` (1401 行)
- `tree-selector.ts` (1079 行)

---

## 目录

1. [核心架构](#核心架构)
2. [JSONL 文件格式](#jsonl-文件格式)
3. [树形结构](#树形结构)
4. [会话生命周期](#会话生命周期)
5. [分支机制](#分支机制)
6. [压缩机制](#压缩机制)
7. [SessionManager API](#sessionmanager-api)
8. [树形导航 UI](#树形导航-ui)
9. [最佳实践](#最佳实践)

---

## 核心架构

### 设计理念

pi 的会话系统遵循 **单文件持久化 + 树形历史**的设计：

```
核心思想：
1. 单个会话 = 单个 JSONL 文件
2. 所有历史 = 树形结构（通过 id/parentId 连接）
3. 无限制分支 = 在任何点都可以分支
4. 自动压缩 = 保持上下文在限制内
5. 可恢复 = 旧会话随时可以继续工作
```

### 数据模型

```typescript
// 1. FileEntry (文件中的条目，包含头部)
type FileEntry = SessionHeader | SessionEntry;

// 2. SessionHeader (会话头部)
interface SessionHeader {
  type: "session";
  id: string;              // 8 字符 hex 码
  timestamp: string;       // ISO 8601
  cwd: string;            // 工作目录
  version?: number;         // 当前版本：3
  parentSession?: string;  // 如果是 fork 的会话
}

// 3. SessionEntry (所有条目基类)
interface SessionEntryBase {
  type: string;            // "message", "compaction", etc.
  id: string;             // 8 字符 hex 码
  parentId: string | null; // 父条目 ID（树形结构）
  timestamp: string;       // ISO 8601
}

// 4. SessionMessageEntry (用户/助手消息)
interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage; // pi-ai 的消息格式
}

// 5. CompactionEntry (压缩条目)
interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;                    // 压缩摘要
  firstKeptEntryId: string;           // 保留的第一个条目 ID
  tokensBefore: number;              // 压缩前的 token 数
  details?: T;                        // 扩展数据（如 artifact 索引）
  fromHook?: boolean;                 // 是否由扩展生成
}

// 6. BranchSummaryEntry (分支摘要)
interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;                    // 从哪个点分支
  summary: string;                    // 分支摘要
  details?: T;                        // 扩展数据
  fromHook?: boolean;                 // 是否由扩展生成
}

// 7. LabelEntry (标签条目)
interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;                   // 目标条目 ID
  label: string | undefined;           // 标签内容（undefined = 删除标签）
}

// 8. SessionInfoEntry (会话信息)
interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;                        // 用户定义的会话名称
}

// 9. ThinkingLevelChangeEntry (思考级别变化)
interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;              // "off", "minimal", "low", "medium", "high", "xhigh"
}

// 10. ModelChangeEntry (模型切换)
interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;                   // "anthropic", "openai", etc.
  modelId: string;                    // "claude-sonnet-4-20250514"
}

// 11. CustomEntry (扩展自定义条目，不发送给 LLM)
interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;                 // 扩展标识符
  data?: T;                           // 扩展数据
}

// 12. CustomMessageEntry (扩展自定义消息，发送给 LLM)
interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;                 // 扩展标识符
  content: string | (TextContent | ImageContent)[];  // 消息内容
  display: boolean;                    // 是否在 TUI 中显示
  details?: T;                           // 扩展元数据（不发送给 LLM）
}
```

---

## JSONL 文件格式

### 文件结构

```jsonl
{"type": "session", "id": "a1b2c3d4", "timestamp": "2026-02-09T00:00:00.000Z", "cwd": "/Users/ccc/work/project"}
{"type": "message", "id": "e5f6g7h8i", "parentId": "a1b2c3d4", "timestamp": "2026-02-09T00:00:01.000Z", "message": {...}}
{"type": "compaction", "id": "j9k0l1m2n", "parentId": "z3x0c3d4", "timestamp": "2026-02-09T00:10:00.000Z", "summary": "...", "firstKeptEntryId": "y4f1g7h8i", "tokensBefore": 10000, "details": {...}}
{"type": "branch_summary", "id": "p1q2r3s4t", "parentId": "y4f1g7h8i", "timestamp": "2026-02-09T00:11:00.000Z", "fromId": "y4f1g7h8i", "summary": "...", "details": {...}}
{"type": "message", "id": "a6b3c4d5e", "parentId": "p1q2r3s4t", "timestamp": "2026-02-09T00:11:01.000Z", "message": {...}}
...
```

### 格式特点

1. **每行一个 JSON** - 标准的 JSONL 格式
2. **顺序写入** - 新条目追加到文件末尾
3. **不可变性** - 已写入的条目永不修改
4. **追加式持久化** - `appendFileSync` 追加新条目
5. **完整文件重建** - `/tree` 命令复制历史到新文件

### 优势

- ✅ **高效**: 只追加新条目，不需要重写整个文件
- ✅ **原子性**: 每个条目独立，部分损坏不影响其他条目
- ✅ **版本控制友好**: Git 可以追踪每一行变化
- ✅ **易于解析**: 逐行读取，逐行解析

### 版本演进

| 版本 | 变化 | 原因 |
|------|------|------|
| v1 | 无 id/parentId | 早期版本，线性结构 |
| v2 | 添加 id/parentId | 支持树形分支 |
| v3 | role: "hookMessage" → role: "custom" | 重命名，更清晰 |

---

## 树形结构

### ID 生成机制

```typescript
function generateId(byId: { has(id: string }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);  // UUID 的前 8 位
    if (!byId.has(id)) return id;
  }
  // 如果 100 次都碰撞（极不可能），使用完整 UUID
  return randomUUID();
}
```

**设计考虑**：
- **8 字符** - 足够避免碰撞，但足够短，易于阅读
- **碰撞检测** - 在当前会话的所有 ID 中检查
- **UUID 前缀** - 利用 crypto.randomUUID() 的高性能

### 树形构建

```typescript
// 构建树形结构
function getTree(): SessionTreeNode {
  const entries = this.getEntries();
  const byId = new Map<string, SessionEntry>();
  
  // 构建 ID 索引
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  
  // 找到当前 leaf（活跃点）
  let leaf = this.leafId ? byId.get(this.leafId) : entries[entries.length - 1];
  
  // 从 leaf 到 root 遍历，收集路径
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  
  // 构建树形节点
  return {
    entry: leaf,
    children: this.getChildren(leaf.id),  // 所有子条目
    label: this.getLabel(leaf.id)       // 用户定义的标签
  };
}
```

**树形节点结构**：

```typescript
interface SessionTreeNode {
  entry: SessionEntry;          // 当前条目
  children: SessionTreeNode[];  // 子条目
  label?: string;                 // 用户标签
}
```

### 树形可视化

ASCII 艺术：

```
Root
├─ user: "分析 pi-mono 项目"
│  └─ assistant: "好的，我来分析"
│     ├─ user: "先看看 extensions"
│     │  └─ assistant: "Extensions 是核心"
│     │        ├─ user: "那会话管理呢？"
│     │        └─ assistant: "会话管理负责..."
│     │
│     └─ [branch_summary] "切换到工具分析"
│
└─ user: "好的，分析工具"
   └─ assistant: "工具调用系统..."
```

---

## 会话生命周期

### 启动流程

```typescript
// 1. 创建 SessionManager
const manager = new SessionManager(sessionFile, cwd);

// 2. 初始化（如果没有会话文件）
if (!existsSync(sessionFile)) {
  manager.initializeNewSession(cwd);
}

// 3. 加载现有会话
const entries = manager.loadEntriesFromFile(sessionFile);

// 4. 版本迁移
migrateToCurrentVersion(entries);

// 5. 构建索引
const byId = new Map<string, SessionEntry>();
for (const entry of entries) {
  byId.set(entry.id, entry);
}
```

### 消息追加流程

```typescript
class SessionManager {
  appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateId(this.byId),
      parentId: this.leafId,    // 追加到当前 leaf 后面
      timestamp: new Date().toISOString(),
      message
    };
    
    this._appendEntry(entry);  // 写入文件并更新索引
    return entry.id;
  }
  
  private _appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;        // 更新当前 leaf
    this._persist(entry);
  }
  
  private _persist(entry: SessionEntry): void {
    if (!this.flushed) {
      // 第一次刷新：写入所有条目
      for (const e of this.fileEntries) {
        appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
      }
      this.flushed = true;
    } else {
      // 后续刷新：只追加新条目
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
  }
}
```

### 会话上下文构建

```typescript
// 从树的某个点构建 LLM 上下文
function buildSessionContext(
  entries: SessionEntry[],
  leafId: string | null,           // 从哪个点开始
  byId?: Map<string, SessionEntry>
): SessionContext {
  const messages: AgentMessage[] = [];
  const thinkingLevel = "off";
  const model = { provider: string, modelId: string } | null;
  
  // 1. 找到 leaf
  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  
  // 2. 从 leaf 到 root 遍历，收集路径
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  
  // 3. 提取设置和压缩信息
  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    } else if (entry.type === "compaction") {
      // 处理压缩
    }
  }
  
  // 4. 构建消息序列（处理压缩和分支摘要）
  // 压缩后的上下文只包含：
  // - 压缩摘要
  // - 压缩后的消息
  // - 压缩后的分支摘要
  
  return { messages, thinkingLevel, model };
}
```

**关键点**：

1. **Leaf 驱动** - 从 leafId 开始，不是总是从最新条目
2. **路径重建** - 通过 parentId 向上遍历重建完整路径
3. **智能过滤** - BranchSummary 和 Compaction 在 LLM 上下文中有特殊处理
4. **设置提取** - ThinkingLevel 和 ModelChange 从路径中提取

---

## 分支机制

### 树形分支概念

pi 的"分支"不是创建新文件，而是在**同一个文件中创建新的路径**：

```
原始树：
Root (A)
└─ B
   └─ C
      └─ D (leaf)

在 C 点分支：
Root (A)
└─ B
   ├─ C (继续)
   │  └─ D (新分支 leaf)
   │
   └─ [branch_summary] "从 C 分支到 D"

结果：同一个文件中有两条从 root 到 leaf 的路径
```

### /fork 命令实现

```typescript
// SessionManager 中的 fork 方法
async fork(entryId: string): Promise<{ cancelled: boolean }> {
  // 1. 找到要 fork 的条目
  const entry = this.getEntry(entryId);
  if (!entry) {
    this.ui?.notify(`Entry ${entryId} not found`, "error");
    return { cancelled: true };
  }
  
  // 2. 选择器 UI
  const selected = await this.ui.custom<boolean>(
    async (tui, theme, keybindings, done) => {
      // 创建树形选择器
      const tree = this.getTree();
      return new TreeSelector(tree, entryId, done);
    },
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        height: "70%"
      }
    }
  );
  
  if (selected === undefined || selected === null) {
    return { cancelled: true };
  }
  
  // 3. 创建新会话文件
  const sessionManager = await createSessionManager(
    selected,
    cwd,
    setup: async (newManager) => {
      // 4. 复制历史到新文件
      const entries = newManager.getEntries();
      const entry = entries.find(e => e.id === selected);
      
      if (entry) {
        const path: newManager.buildPath(entry);
        newManager.appendMessage(entry.message);
        
        // 添加分支摘要
        const fromId = entry.parentId;
        const summary = "Forked from branch";
        newManager.appendBranchSummary(fromId, summary, { selectedEntryId: entry.id });
      }
      
      // 复制标签（可选）
      const label = this.getLabel(entry.id);
      if (label) {
        newManager.appendLabelChange(entry.id, label);
      }
    }
  );
  
  return { cancelled: false };
}
```

### 分支摘要

```typescript
// 添加分支摘要
interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;        // 从哪个点分支
  summary: string;        // 分支摘要
  details?: T;            // 扩展数据
  fromHook?: boolean;     // 是否由扩展生成
}

// LLM 上下文处理
// BranchSummaryEntry 会作为用户消息添加到上下文中
// 这样 LLM 知道发生了分支切换
```

**使用场景**：

1. **实验不同方案** - 在某个点 fork 出多个分支尝试不同方法
2. **并行工作** - 多个分支同时进行
3. **回滚和比较** - 随时切换回之前的分支
4. **保存快照** - 在重要节点分支作为备份

---

## 压缩机制

### 压缩触发时机

```typescript
// 自动压缩触发条件
const COMPACT_THRESHOLD_RATIO = 0.9;  // 当使用达到 90% 时
const COMPACT_ABSOLUTE_THRESHOLD = 200000; // 绝对阈值 200K tokens

// 检测是否需要压缩
function needsCompaction(currentUsage: ContextUsage): boolean {
  const { tokens, contextWindow } = currentUsage;
  return tokens >= contextWindow * COMPACT_THRESHOLD_RATIO ||
         tokens >= COMPACT_ABSOLUTE_THRESHOLD;
}

// 压缩钩子
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, signal } = event;
  
  // 1. 检查是否要阻止压缩
  if (shouldSkipCompaction(branchEntries)) {
    return { cancel: true };
  }
  
  // 2. 执行自定义压缩
  const compactionResult = await customCompaction({
    entries: branchEntries,
    instructions: customInstructions
  });
  
  // 3. 返回压缩结果
  return {
    cancel: false,
    compaction: compactionResult
  };
});
```

### 压缩算法

**默认压缩策略**（保留最近 50 条消息）：

```typescript
async function defaultCompaction(
  entries: SessionEntry[],
  preparation: CompactionPreparation
): Promise<CompactionResult> {
  const { firstKeptEntryId, tokensBefore } = preparation;
  
  // 1. 找到 firstKeptEntryId 在数组中的索引
  const keepIndex = entries.findIndex(e => e.id === firstKeptEntryId);
  
  // 2. 保留前 50 条（包括 firstKeptEntryId）
  // firstKeptEntryId 是第 keepIndex 条
  // 保留 0 到 keepIndex 的所有条目
  const keepCount = 50;
  const entriesToKeep = entries.slice(0, keepIndex + 1);
  
  // 3. 生成摘要
  const summary = `Compacted: kept ${keepCount} messages`;
  const tokensAfter = calculateTokensAfterCompaction(entriesToKeep);
  
  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
    tokensAfter
  };
}
```

### 自定义压缩

扩展可以完全自定义压缩逻辑：

```typescript
// 示例：按项目文件分组的压缩
pi.on("session_before_compact", async (event, ctx) => {
  const { branchEntries, signal } = event;
  
  // 1. 按项目文件分组
  const byProject = groupByProject(branchEntries);
  
  // 2. 为每个项目保留关键信息
  const entriesToKeep = [];
  const artifacts = [];
  
  for (const [project, entries] of Object.entries(byProject)) {
    // 保留每个项目的最新状态
    const latest = entries[entries.length - 1];
    entriesToKeep.push(latest);
    
    // 收集 artifact 索引
    const artifactIndex = extractArtifactIndex(entries);
    artifacts.push(artifactIndex);
  }
  
  // 3. 生成结构化摘要
  const summary = `
Compacted by project:
${Object.entries(byProject).map(([project, entries]) =>
  `- ${project}: ${entries.length} files kept`).join('\n')}

Artifact indexes: ${JSON.stringify(artifacts)}
  `;
  
  return {
    cancel: false,
    compaction: {
      summary,
      firstKeptEntryId: entriesToKeep[entriesToKeep.length - 1].id,
      tokensBefore: event.preparation.currentTokens,
      details: { byProject, artifacts }
    }
  };
});
```

### 压缩条目结构

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;    // 保留的第一个条目 ID（重建上下文的锚点）
  tokensBefore: number;
  details?: T;                  // 扩展数据
  fromExtension?: boolean;       // 是否由扩展生成
}
```

**LLM 上下文重建**：

```typescript
function buildSessionContext(entries, leafId) {
  // ... 遍历路径 ...
  
  let compaction: CompactionEntry | null = null;
  
  for (const entry of path) {
    if (entry.type === "compaction") {
      compaction = entry;  // 找到压缩点
      break;
    }
  }
  
  if (compaction) {
    // 1. 先发送压缩摘要
    messages.push({
      role: "assistant",
      content: compaction.summary,
      timestamp: compaction.timestamp
    });
    
    // 2. 找到 firstKeptEntryId
    const keptIndex = path.findIndex(e => e.id === compaction.firstKeptEntryId);
    
    // 3. 发送压缩后的消息（从 firstKeptEntryId 开始）
    for (let i = keptIndex; i < path.length; i++) {
      const entry = path[i];
      if (entry.type === "message") {
        messages.push(entry.message);
      } else if (entry.type === "custom_message") {
        // 转换为用户消息
        messages.push(createCustomMessage(entry));
      } else if (entry.type === "branch_summary") {
        messages.push({
          role: "assistant",
          content: entry.summary,
          timestamp: entry.timestamp
        });
      }
    }
  }
  
  return { messages, ... };
}
```

---

## SessionManager API

### 核心方法

```typescript
class SessionManager {
  // ========== 基础信息 ==========
  cwd: string;                 // 工作目录
  sessionFile: string;          // 会话文件路径
  leafId: string | null;      // 当前 leaf ID
  
  // ========== 索引 ==========
  byId: Map<string, SessionEntry>;     // ID → 条目
  labelsById: Map<string, string>;     // ID → 标签
  
  // ========== 状态 ==========
  fileEntries: SessionEntry[];        // 内存中的所有条目
  flushed: boolean;                     // 是否已刷新到文件
  
  // ========== 追加方法 ==========
  appendMessage(message: Message | CustomMessage | BashExecutionMessage): string;
  appendThinkingLevelChange(thinkingLevel: string): string;
  appendModelChange(provider: string, modelId: string): string;
  appendCompaction<T = unknown>(...): string;
  appendBranchSummary<T = unknown>(...): string;
  appendCustomEntry<T = unknown>(customType: string, data?: T): string;
  appendSessionInfo(name: string): string;
  appendLabelChange(targetId: string, label: string | undefined): string;
  
  // ========== 查询方法 ==========
  getLeafId(): string | null;
  getLeafEntry(): SessionEntry | undefined;
  getEntry(id: string): SessionEntry | undefined;
  getLabel(id: string): string | undefined;
  getChildren(parentId: string): SessionEntry[];
  getEntries(): SessionEntry[];
  getTree(): SessionTreeNode[];
  getBranch(entryId: string): SessionEntry[];
  getSessionName(): string | undefined;
  
  // ========== 上下文方法 ==========
  buildSessionContext(leafId?: string | null): SessionContext;
  
  // ========== 会话信息 ==========
  getSessionFile(): string;
  getCwd(): string;
  getSessionId(): string;
}
```

### 高级方法

```typescript
// 查找最近的条目
function getMostRecentEntry(
  entries: SessionEntry[],
  type: string,
  afterTimestamp: number
): SessionEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === type && entry.timestamp > afterTimestamp) {
      return entry;
    }
  }
  return undefined;
}

// 获取修改时间
function getSessionModifiedDate(
  entries: FileEntry[],
  header: SessionHeader,
  statsMtime: Date
): Date {
  const lastActivityTime = getLastActivityTime(entries);
  if (typeof lastActivityTime === "number" && lastActivityTime > 0) {
    return new Date(lastActivityTime);
  }
  const headerTime = parseTimestamp(header.timestamp);
  return !Number.isNaN(headerTime) ? new Date(headerTime) : statsMtime;
}
```

---

## 树形导航 UI

### TreeSelector 组件

```typescript
class TreeSelector implements Component, Focusable {
  private flatNodes: FlatNode[] = [];     // 扁平化的树节点
  private selectedIndex = 0;             // 当前选中索引
  private currentLeafId: string | null;    // 当前 leaf ID
  
  // 查询和过滤
  private searchQuery = "";
  private filterMode: FilterMode = "default";
  private activePathIds: Set<string>;
  
  // 处理键盘输入
  handleInput(data: string): void {
    const keyId = data.toLowerCase() as KeyId;
    
    switch (keyId) {
      case "j":
      case "arrowdown":
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredNodes.length - 1);
        break;
        
      case "k":
      case "arrowup":
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        break;
        
      case "g":
      case "home":
        this.selectNearestLeaf();
        break;
        
      case "enter":
      case " " ":
        if (this.onSelect) {
          this.onSelect(this.filteredNodes[this.selectedIndex].node.entry.id);
        }
        break;
        
      case "escape":
        if (this.onCancel) {
          this.onCancel();
        }
        break;
        
      case "/":
        this.searchQuery = "";
        this.applyFilter();
        break;
        
      default:
        // 搜索输入
        if (keyId.length === 1) {
          this.searchQuery += keyId;
          this.applyFilter();
        }
        break;
    }
  }
}
```

### 扁平化算法

```typescript
// 将树形结构转换为扁平列表，便于键盘导航
private flattenTree(roots: SessionTreeNode[]): FlatNode[] {
  const result: FlatNode[] = [];
  this.toolCallMap.clear();
  
  // 后序遍历，确保子节点在父节点后面
  const postOrderStack: SessionTreeNode[] = [...roots];
  const allNodes: SessionTreeNode[] = [];
  
  while (postOrderStack.length > 0) {
    const node = postOrderStack.pop()!;
    allNodes.push(node);
    // 添加子节点（倒序）
    for (let i = node.children.length - 1; i >= 0; i--) {
      postOrderStack.push(node.children[i]);
    }
  }
  
  // 计算缩进和连接符
  const stack: StackItem[] = [];
  const indent = 0;
  
  // 处理所有节点
  for (const node of allNodes) {
    // ... 计算缩进、连接符等 ...
    result.push({
      node,
      indent,
      showConnector: ...,
      isLast: ...,
      gutters: [...],
      isVirtualRootChild: ...
    });
  }
  
  return result;
}
```

### 缩进规则

```typescript
// 缩进计算（每级 3 个空格）
const calculateIndent = (node: SessionTreeNode, parentIndent: number): number => {
  if (node.children.length <= 1) {
    return parentIndent;
  } else if (node.children.length > 1 && parentIndent === 0) {
    return parentIndent + 1;
  }
  return parentIndent;
};

// 连接符规则
// ├─  中间节点
// └─  最后一个子节点
// ┌─  虚拟根的第一个子节点（多个根时）
```

### 过滤模式

```typescript
type FilterMode = 
  | "default"      // 显示所有条目
  | "no-tools"     // 排除工具执行相关的条目
  | "user-only"    // 只显示用户消息
  | "labeled-only" // 只显示有标签的条目
  | "all";         // 显示所有（包括工具执行）

applyFilter(): void {
  this.filteredNodes = this.flatNodes.filter(node => {
    // 根据模式过滤
    switch (this.filterMode) {
      case "no-tools":
        return !this.isToolRelated(node);
      case "user-only":
        return this.isUserMessage(node);
      case "labeled-only":
        return this.getLabel(node.entry.id) !== undefined;
      case "all":
        return true;
      default:
        return true;
    }
  });
  
  // 重新计算选中索引
  this.selectedIndex = this.findNearestVisibleIndex(this.currentLeafId);
}
```

### ASCII 艺术

```typescript
// 渲染单个节点
renderNode(node: FlatNode, theme: Theme): Component {
  const { indent, showConnector, isLast, gutters } = node;
  
  const connector = showConnector
    ? (isLast ? "└─" : "├─")
    : (indent > 0 ? "│  " : "   ");
  
  // 构建连接线
  let line = "";
  for (let i = 0; i < indent; i++) {
    if (gutters[i]?.show) {
      line += "│  ";
    } else {
      line += "   ";
    }
  }
  
  return html`<div>${line}${connector} ${this.renderEntry(node)}</div>`;
}
```

---

## 最佳实践

### 1. 会话管理

#### ✅ DO

- **使用 /tree 命令** - 浏览整个会话历史
- **使用 /fork 实验不同方案** - 不要破坏主分支
- **设置标签** - 在重要节点标记，便于导航
- **定期压缩** - 避免上下文过大
- **定期 /new** - 开始新的干净会话

#### ❌ DON'T

- **不要在超长会话中继续** - 启动新会话更清晰
- **不要频繁压缩** - 会丢失压缩期间的上下文细节
- **不要忽略压缩警告** - 会话过长时 LLM 会丢失早期信息

### 2. 分支管理

#### ✅ DO

- **给分支起描述性名称** - 使用 `/session-name`
- **在分支点添加标签** - 标记实验目的
- **使用 /fork 创建明确的实验分支**
- **实验完成后合并** - `/tree` 找回主分支继续

#### ❌ DON'T

- **不要创建过多的分支** - 难以管理
- **不要在没有明确目的时分支** - 每个分支都应有意义
- **不要忘记切换回主分支** - 实验后回到主线

### 3. 性能优化

#### ✅ DO

- **会话文件保持合理大小** - < 10MB 最佳，< 50MB 可接受
- **避免过度追加以条目** - `fileEntries` 只在内存中保留必要部分
- **使用懒加载** - 需要时才读取历史
- **定期 /new** - 保持会话文件精简

#### ❌ DON'T

- **不要在内存中保留完整历史** - 会话很长时内存占用高
- **不要频繁 flush** - 每个条目都写入会影响性能
- **不要忽略警告** - 会话文件过大时会有提示

### 4. 扩展开发

#### ✅ DO

- **使用 session_before_compact 事件** - 自定义压缩逻辑
- **使用 session_before_tree 事件** - 自定义树导航
- **返回结构化 compaction 数据** - 在 details 字段中
- **添加有用的标签** - 帮助扩展理解上下文

#### ❌ DON'T

- **不要在压缩中丢失重要信息** - 确保摘要包含关键数据
- **不要阻止不必要的压缩** - 压缩是保持上下文的重要机制
- **不要忽略信号** - 注意 AbortSignal

### 5. 调试和故障排除

#### ✅ DO

- **使用 /tree 检查会话结构** - 验证树形连接正确
- **使用 /session 查看 meta 信息** - 了解会话状态
- **查看会话文件内容** - JSONL 格式，易于调试
- **使用标签标记关键点** - 便于快速定位

#### ❌ DON'T

- **不要手动编辑 JSONL 文件** - 容易破坏格式
- **不要使用旧版本 API** - 依赖当前版本的结构
- **不要忽略警告** - 日志中有错误提示

---

## 关键源码文件

- `packages/coding-agent/src/core/session-manager.ts` - 会话管理核心 (1401 行)
- `packages/coding-agent/src/modes/interactive/components/tree-selector.ts` - 树形导航 UI (1079 行)
- `packages/coding-agent/src/core/messages.ts` - 消息类型定义
- `packages/coding-agent/docs/session.md` - 会话系统文档

---

**下一步**: 深度分析 #3 工具调用系统
