# pi-mono TUI 终端 UI 深度分析

**创建时间**: 2026-02-09 06:57 GMT+8
**任务编号**: #5
**类型**: 深度分析
**分析文件**: 
- `packages/tui/src/lib/components/` (组件库)
- `packages/tui/src/lib/editor.ts` (交互式编辑器)
- `packages/tui/src/lib/keybindings.ts` (快捷键系统）
- `packages/tui/src/lib/tui.ts` (TUI 核心类）
- `packages/coding-agent/src/modes/interactive/components/` (UI 组件）

---

## 目录

1. [差分渲染原理](#差分渲染原理)
2. [TUI 核心架构](#tui-核心架构)
3. [组件系统](#组件系统)
4. [交互式编辑器](#交互式编辑器)
5. [快捷键系统](#快捷键系统)
6. [文件引用机制](#文件引用机制)
7. [消息队列 UI](#消息队列-ui)
8. [主题系统](#主题系统)

---

## 差分渲染原理

### 核心思想

**差分渲染** (Differential Rendering) 只重绘终端界面中**发生变化的部分**，避免重绘整个屏幕。

```
原理：
1. 保存当前渲染快照 (Component × Position = Content)
2. 下次渲染时计算新快照
3. 计算差异 (Diff) = 新快照 - 旧快照
4. 只重绘差异部分

好处：
- 极快的渲染性能 (O(n) → O(Δn)，其中 Δn 是变化部分）
- 最小化终端闪烁
- 节省 CPU 资源
```

### 差分算法

```typescript
// packages/tui/src/lib/diff.ts
export class TerminalDiffer {
  private previousSnapshot: Map<Component, TerminalCell[]>;
  
  // 计算差异
  diff(
    components: Component[],
    previousComponents: Map<Component, TerminalCell[]>
  ): DiffResult {
    const newSnapshot = this.captureSnapshot(components);
    const diff = this.computeDiff(previousSnapshot, newSnapshot);
    this.previousSnapshot = newSnapshot;
    return diff;
  }
  
  // 捕获快照
  private captureSnapshot(components: Component[]): Map<Component, TerminalCell[]> {
    const snapshot = new Map();
    
    for (const component of components) {
      const cells = this.renderComponent(component);
      snapshot.set(component, cells);
    }
    
    return snapshot;
  }
  
  // 计算差异
  private computeDiff(
    prev: Map<Component, TerminalCell[]>,
    next: Map<Component, TerminalCell[]>
  ): DiffResult {
    const operations: DiffOperation[] = [];
    
    // 比较每个组件
    for (const component of next.keys()) {
      const prevCells = prev.get(component);
      const nextCells = next.get(component);
      
      // 查找变化的行
      const changes = this.findChangedLines(prevCells, nextCells);
      
      // 生成更新操作
      for (const change of changes) {
        operations.push({
          type: "update_line",
          component,
          row: change.row,
          cells: change.cells
        });
      }
    }
    
    return { operations };
  }
}
```

### DiffOperation 类型

```typescript
interface DiffOperation {
  type: "update_line" | "delete_lines" | "insert_lines" | "move_lines";
  component: Component;
  row: number;
  cells?: TerminalCell[];
  count?: number;
}

interface DiffResult {
  operations: DiffOperation[];
  totalCells: number;
}
```

---

## TUI 核心架构

### TUI 类

```typescript
export class TUI {
  // ========== 状态 ==========
  private components: Component[];
  private overlay: OverlayHandle | null;
  private focusStack: Focusable[];
  private shouldExit = false;
  
  // ========== 渲染配置 ==========
  private width: number;
  private height: number;
  private differ: TerminalDiffer;
  
  // ========== 输入流 ==========
  private inputStream: NodeJS.ReadStream;
  private inputBuffer: string;
  
  // ========== 公共 API ==========
  async init(): Promise<void>;
  async start(): Promise<void>;
  stop(): void;
  
  // 组件管理
  render(component: Component): void;
  showOverlay(component: Component, options?: OverlayOptions): void;
  hideOverlay(): void;
  
  // 聚焦管理
  focus(component: Focusable): void;
  blur(): void;
  
  // 退出控制
  exit(): void;
}
```

### 初始化流程

```typescript
// packages/tui/src/lib/tui.ts
export class TUI {
  async init(): Promise<void> {
    // 1. 设置终端为原始模式
    process.stdout.write("\x1b[?25l");
    
    // 2. 隐藏光标
    process.stdout.write("\x1b[?25l");
    
    // 3. 启用鼠标报告（用于终端尺寸检测）
    process.stdout.write("\x1b[?1000h");
    
    // 4. 请求终端尺寸
    process.stdout.write("\x1b[6n");
    this.width = await this.queryTerminalSize();
    process.stdout.write("\x1b[r");
    
    // 5. 创建差分器
    this.differ = new TerminalDiffer();
  }
}
```

### 主渲染循环

```typescript
export class TUI {
  private async mainLoop(): Promise<void> {
    while (!this.shouldExit) {
      try {
        // 1. 渲染组件
        const { components } = this.getCurrentComponents();
        const diff = this.differ.diff(components, this.components);
        
        // 2. 应用差异到终端
        for (const op of diff.operations) {
          this.applyOperation(op);
        }
        
        // 3. 等待输入
        const input = await this.waitForInput();
        
        // 4. 处理输入
        await this.handleInput(input);
        
      } catch (error) {
        this.handleError(error);
      }
    }
  }
  
  private applyOperation(op: DiffOperation): void {
    switch (op.type) {
      case "update_line":
        // 移动到行
        process.stdout.write(`\x1b[${op.row + 1};1H`);
        // 更新行内容
        const line = this.renderCells(op.cells!);
        process.stdout.write(line);
        break;
      
      case "delete_lines":
        // 清除行
        const rowsToDelete = op.count || 1;
        process.stdout.write(`\x1b[${rowsToDelete}M`);
        break;
      
      case "insert_lines":
        // 插入行
        process.stdout.write(`\n${op.cells?.join("") || ""}`);
        break;
      
      case "move_lines":
        // 移动行
        process.stdout.write(`\x1b[${op.row + 1};${op.count}r`);
        break;
    }
  }
}
```

---

## 组件系统

### 基础组件

```typescript
// 文本组件
export function Text(props: {
  text: string;
  color?: string;           // 颜色：red, green, blue, yellow, cyan, magenta, white, gray
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}): Component {
  return {
    type: "text",
    props,
    render(theme: Theme): TerminalCell[] {
      return [
        {
          char: props.text,
          fg: props.color ? theme.colors[props.color] : theme.colors.fg,
          bold: props.bold || false,
          dim: props.dim || false,
          underline: props.underline || false,
          bg: theme.colors.bg
        }
      ];
    }
  };
}

// 容器组件
export function Container(props: {
  children: Component[];
  border?: boolean;
  padding?: number;
  margin?: number;
  align?: "left" | "center" | "right";
}): Component {
  return {
    type: "container",
    props,
    render(theme: Theme): TerminalCell[] {
      // ... 复杂的容器渲染逻辑
    }
  };
}

// Spacer 组件
export function Spacer(props: {
  height: number;
}): Component {
  return {
    type: "spacer",
    props,
    render(theme: Theme): TerminalCell[] {
      return new Array(props.height).fill({
        char: "\n",
        fg: theme.colors.fg,
        bg: theme.colors.bg
      });
    }
  };
}
```

### 可聚焦组件

```typescript
interface Focusable {
  handleInput(data: string): void;
  handleFocus(): void;
  handleBlur(): void;
}

// 示例：Input 组件（多行编辑器）
export function Input(props: {
  onChange: (text: string) => void;
  onSubmit: () => void;
}): Component {
  return {
    type: "input",
    props,
    render(theme: Theme): TerminalCell[] {
      return [];  // 在 focus 时才渲染
    },
    
    create(tui: TUI): Focusable {
      const editor = new Editor(props, tui);
      return editor;
    }
  };
}
```

---

## 交互式编辑器

### 核心功能

```typescript
class Editor implements Focusable {
  // ========== 状态 ==========
  private text: string;
  private cursor: { row: number; col: number };
  private scrollOffset: number;
  
  // ========== 配置 ==========
  private maxRows: number;
  private maxCols: number;
  private wrapAtColumn?: number;
  
  // ========== 快捷键绑定 ==========
  private keybindings: KeybindingsManager;
  
  // ========== 输入处理 ==========
  handleInput(data: string): void {
    const keyId = data.toLowerCase() as KeyId;
    
    switch (keyId) {
      case "enter":
      case "return":
        if (this.shiftKey) {
          // Shift+Enter: 插入新行
          this.insertNewLine();
        } else {
          // Enter: 提交
          this.onSubmit?.();
        }
        break;
        
      case "escape":
        // 取消编辑
        this.onCancel?.();
        break;
        
      case "backspace":
        this.deleteBackward();
        break;
        
      case "delete":
        this.deleteForward();
        break;
        
      case "arrowup":
      case "k":
        this.moveUp();
        break;
        
      case "arrowdown":
      case "j":
        this.moveDown();
        break;
        
      case "arrowleft":
      case "h":
        this.moveLeft();
        break;
        
      case "arrowright":
      case "l":
        this.moveRight();
        break;
        
      case "ctrl+a":
      case "ctrl+e":
        // 文本操作
        break;
        
      default:
        // 插入字符
        if (data.length === 1) {
          this.insertChar(data);
        }
        break;
    }
  }
}
```

### 文件引用 (@ 符号）

```typescript
class Editor {
  private handleAtSymbol(): void {
    const beforeCursor = this.getTextBeforeCursor();
    const match = beforeCursor.match(/@([^\s@]+)$/);
    
    if (match) {
      const reference = match[1];
      
      // 1. 触发文件选择
      this.showFilePicker(reference);
      
      // 2. 替换 @reference 为文件内容
      this.replaceToken(match[0], fileContent);
    }
  }
  
  private showFilePicker(reference: string): void {
    const files = this.findMatchingFiles(reference);
    
    if (files.length === 0) {
      this.ui?.notify(`No files found: ${reference}`, "info");
      return;
    }
    
    if (files.length === 1) {
      // 只有一个文件，直接使用
      const content = this.readFile(files[0]);
      this.replaceToken(match[0], content);
    } else {
      // 多个文件，显示选择器
      const selected = this.ui.select(
        "Select file",
        files.map(f => f.name)
      );
      
      if (selected) {
        const file = files.find(f => f.name === selected);
        const content = this.readFile(file!);
        this.replaceToken(match[0], content);
      }
    }
  }
  
  private replaceToken(
    token: string,     // 例如 "@file.txt"
    replacement: string  // 文件内容
  ): void {
    const beforeCursor = this.getTextBeforeCursor();
    const afterCursor = this.getTextAfterCursor();
    const newBeforeCursor = beforeCursor.slice(0, -token.length) + replacement;
    const newFullText = newBeforeCursor + afterCursor;
    
    this.text = newFullText;
    this.cursor.col = replacement.length;
    
    // 通知文本变化
    this.onChange?.(newFullText);
  }
}
```

### 滚动优化

```typescript
class Editor {
  // 虚拟滚动
  private virtualRows: string[];
  private visibleRows: number;
  private firstVisibleRow: number;
  
  // 计算可见行
  private updateVisibleRows(): void {
    const totalRows = this.text.split("\n").length;
    const screenHeight = this.maxRows;
    
    // 1. 检查是否需要滚动
    if (this.cursor.row - this.firstVisibleRow > screenHeight - 3) {
      this.firstVisibleRow = this.cursor.row - Math.floor(screenHeight / 2);
    } else if (this.cursor.row < this.firstVisibleRow) {
      this.firstVisibleRow = Math.max(0, this.cursor.row - Math.floor(screenHeight / 2));
    }
    
    // 2. 更新可见行
    this.visibleRows = Math.min(totalRows, screenHeight);
  }
  
  // 渲染可见区域
  render(theme: Theme): TerminalCell[] {
    const lines = this.text.split("\n");
    const visibleLines = lines.slice(
      this.firstVisibleRow,
      this.firstVisibleRow + this.visibleRows
    );
    
    // 渲染每一行，添加行号
    return visibleLines.map((line, i) => {
      const rowNumber = (this.firstVisibleRow + i + 1).toString();
      const isCursorRow = (this.firstVisibleRow + i) === this.cursor.row;
      
      return [
        // 行号
        this.renderLineNumber(rowNumber),
        // 行内容
        ...this.renderLine(line, isCursorRow)
      ];
    }).flat();
  }
}
```

---

## 快捷键系统

### KeyId 类型

```typescript
// packages/tui/src/lib/keybindings.ts
export type KeyId =
  // 字母和数字
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  
  // 功能键
  | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12"
  
  // 组合键
  | "ctrl+a" | "ctrl+b" | "ctrl+c" | "ctrl+d" | "ctrl+e" | "ctrl+f" | "ctrl+g" | "ctrl+h" | "ctrl+i" | "ctrl+j" | "ctrl+k" | "ctrl+l" | "ctrl+m" | "ctrl+n" | "ctrl+o" | "ctrl+p" | "ctrl+q" | "ctrl+r" | "ctrl+s" | "ctrl+t" | "ctrl+u" | "ctrl+v" | "ctrl+w" | "ctrl+x" | "ctrl+y" | "ctrl+z"
  | "shift+a" | "shift+b" | ... | "shift+z"
  | "alt+a" | "alt+b" | ... | "alt+z"
  | "ctrl+shift+a" | "ctrl+shift+b" | ... | "ctrl+shift+z"
  
  // 特殊键
  | "tab" | "enter" | "escape" | "backspace" | "delete"
  | "arrowup" | "arrowdown" | "arrowleft" | "arrowright"
  | "home" | "end" | "pageup" | "pagedown"
  | "space" | "ctrl+space" | "alt+space" | "shift+space";
```

### KeyAction 枚举

```typescript
export enum KeyAction {
  // ========== 应用级动作 ==========
  interrupt = "interrupt",              // 中断 Agent
  clear = "clear",                      // 清空输入
  exit = "exit",                        // 退出应用
  
  // ========== 编辑器动作 ==========
  externalEditor = "externalEditor",    // 打开外部编辑器
  deleteToLineEnd = "deleteToLineEnd", // 删除到行尾
  
  // ========== 模型切换 ==========
  cycleModelForward = "cycleModelForward",  // 下一个模型
  cycleModelBackward = "cycleModelBackward", // 上一个模型
  selectModel = "selectModel",             // 选择模型
  
  // ========== 工具输出 ==========
  expandTools = "expandTools",           // 展开/收起工具输出
  toggleThinking = "toggleThinking",       // 切换思考模式
  
  // ========== 导航 ==========
  scrollToBottom = "scrollToBottom",       // 滚动到底部
  scrollToTop = "scrollToTop",           // 滚动到顶部
  
  // ========== 提交 ==========
  submit = "submit",                     // 提交输入
  selectConfirm = "selectConfirm",       // 确认选择
  selectCancel = "selectCancel",         // 取消选择
  
  // ========== 复制 ==========
  copy = "copy"                         // 复制选中内容
}
```

### KeybindingsConfig

```typescript
interface KeybindingsConfig {
  [action: string]: KeyId | KeyId[];
  
  // 编辑器快捷键
  [KeyAction.editor: string]: {
    save: KeyId;
    undo: KeyId;
    redo: KeyId;
  };
  
  // 应用快捷键
  [KeyAction.app: string]: {
    quit: KeyId;
  help: KeyId;
  };
}
```

### 快捷键处理

```typescript
class KeybindingsManager {
  private config: KeybindingsConfig;
  private keyMap: Map<KeyId, KeyAction>;
  private modifierKeys: Set<string>;
  
  constructor(config: KeybindingsConfig) {
    this.config = config;
    this.keyMap = this.buildKeyMap();
    this.modifierKeys = new Set(["ctrl", "shift", "alt", "meta"]);
  }
  
  // 构建快捷键映射
  private buildKeyMap(): Map<KeyId, KeyAction> {
    const map = new Map();
    
    for (const [action, keys] of Object.entries(this.config)) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      
      for (const key of keyList) {
        map.set(key, action as KeyAction);
      }
    }
    
    return map;
  }
  
  // 处理按键输入
  handleInput(data: string): KeyAction | undefined {
    // 1. 处理修饰键
    if (this.modifierKeys.has(data)) {
      this.modifierKeys.add(data);
      return undefined;
    }
    
    // 2. 检查是否有组合键
    const keyId = data.toLowerCase() as KeyId;
    const action = this.keyMap.get(keyId);
    
    if (action) {
      return action;
    }
    
    // 3. 处理单键
    if (this.modifierKeys.size > 0) {
      // 等待组合键
      return undefined;
    }
    
    return undefined;
  }
  
  // 清除修饰键状态
  clearModifiers(): void {
    this.modifierKeys.clear();
  }
}
```

---

## 文件引用机制

### @ 符号识别

```typescript
class Editor {
  // 检测 @ 符号
  private detectAtSymbol(): { start: number; end: number } | null {
    const text = this.text;
    const cursorPos = this.getCursorPos();
    
    // 向前扫描最近的 @
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === "@") {
        // 查找到 @ 符号，检查是否是有效的引用
        const rest = text.slice(i);
        const match = rest.match(/^@([a-zA-Z0-9_./-]+)$/);
        
        if (match) {
          return { start: i, end: i + match[1].length };
        }
        
        break;
      }
    }
    
    return null;
  }
  
  // 获取 @ 符号前的文本
  private getTextBeforeAtSymbol(): string {
    const match = this.detectAtSymbol();
    if (match) {
      return this.text.slice(0, match.start);
    }
    return "";
  }
}
```

### 文件查找

```typescript
class Editor {
  private findMatchingFiles(pattern: string): FileResult[] {
    // 1. 解析模式
    const isPattern = pattern.includes("*") || pattern.includes("?");
    const isDir = pattern.endsWith("/");
    
    // 2. 在当前目录查找文件
    const files: FileResult[] = [];
    const searchDir = isDir ? pattern : ".";
    
    try {
      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const matches = this.matchPattern(entry.name, pattern);
        if (matches) {
          const fullPath = path.join(searchDir, entry.name);
          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory
          });
        }
      }
    } catch (error) {
      // 忽略错误
    }
    
    return files;
  }
  
  // 模式匹配
  private matchPattern(filename: string, pattern: string): boolean {
    if (!isPattern) {
      // 精确匹配
      return filename === pattern;
    }
    
    // glob 模式
    const regex = pattern
      .replace(/\*/g, ".*")
      .replace(/\?/g, "[^/]*");
    
    return new RegExp(regex).test(filename);
  }
}
```

### 文件选择 UI

```typescript
class Editor {
  private showFilePicker(files: FileResult[]): void {
    // 1. 过滤只显示文件
    const onlyFiles = files.filter(f => !f.isDirectory);
    
    if (onlyFiles.length === 0) {
      this.ui?.notify("No files found", "info");
      return;
    }
    
    // 2. 显示选择器
    const selected = this.ui.select(
      "Select file",
      onlyFiles.map(f => f.name)
    );
    
    if (selected) {
      const file = onlyFiles.find(f => f.name === selected);
      if (file) {
        this.insertFileContent(file);
      }
    }
  }
  
  private insertFileContent(file: FileResult): void {
    try {
      const content = fs.readFileSync(file.path, "utf-8");
      
      // 插入文件内容到光标位置
      const beforeCursor = this.text.slice(0, this.cursor.pos);
      const afterCursor = this.text.slice(this.cursor.pos);
      
      this.text = beforeCursor + content + afterCursor;
      this.cursor.pos = beforeCursor.length + content.length;
      
      // 通知变化
      this.onChange?.(this.text);
    } catch (error) {
      this.ui?.notify(`Failed to read file: ${error.message}`, "error");
    }
  }
}
```

---

## 消息队列 UI

### Steering 消息队列

```typescript
class MessageQueue {
  private steeringQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  
  // 添加 steering 消息
  addSteering(message: AgentMessage): void {
    this.steeringQueue.push(message);
    this.renderQueue();
  }
  
  // 添加 follow-up 消息
  addFollowUp(message: AgentMessage): void {
    this.followUpQueue.push(message);
    this.renderQueue();
  }
  
  // 清空队列
  clear(): void {
    this.steeringQueue = [];
    this.followUpQueue = [];
    this.renderQueue();
  }
}
```

### 队列渲染

```typescript
class MessageQueue {
  render(): Component {
    const steeringItems = this.steeringQueue.map((msg, i) => 
      this.renderMessageItem(msg, `steering-${i}`, "⏸")
    );
    
    const followUpItems = this.followUpQueue.map((msg, i) => 
      this.renderMessageItem(msg, `followup-${i}`, "📋")
    );
    
    return Container({
      border: true,
      padding: 2,
      children: [
        Text({ text: "Pending messages:", bold: true }),
        ...steeringItems,
        ...followUpItems
      ]
    });
  }
  
  private renderMessageItem(
    message: AgentMessage,
    id: string,
    icon: string
  ): Component {
    return Container({
      children: [
        Text({ text: icon }),
        Spacer({ height: 1 }),
        Text({ text: message.content.substring(0, 50) + (message.content.length > 50 ? "..." : ""), dim: true })
      ]
    });
  }
}
```

### 队列操作

```typescript
// 在编辑器中处理队列
class Editor {
  private handleQueueKey(keyId: KeyId): void {
    switch (keyId) {
      case "escape":
        // 恢复第一条队列消息
        if (this.steeringQueue.length > 0) {
          this.restoreMessage(this.steeringQueue.shift()!);
        }
        break;
        
      case "ctrl+j":
      case "ctrl+k":
        // 在队列中导航
        this.navigateQueue(keyId === "ctrl+j" ? 1 : -1);
        break;
        
      case "delete":
        // 删除当前队列项
        this.deleteCurrentQueueItem();
        break;
    }
  }
}
```

---

## 主题系统

### Theme 结构

```typescript
// packages/tui/src/lib/theme/theme.ts
export interface Theme {
  // ========== 颜色 ==========
  colors: {
    fg: string;           // 前景色
    bg: string;           // 背景色
    primary: string;       // 主要强调色（通常蓝色）
    secondary: string;     // 次要强调色（通常灰色）
    success: string;       // 成功（绿色）
    warning: string;       // 警告（黄色）
    error: string;         // 错误（红色）
    muted: string;        // 静音色
    border: string;       // 边框色
  };
  
  // ========== 语法高亮 ==========
  syntax: {
    keyword: string;       // 关键字
    string: string;        // 字符串
    comment: string;       // 注释
    number: string;       // 数字
    function: string;      // 函数
    variable: string;      // 变量
    operator: string;      // 操作符
  };
  
  // ========== UI 样式 ==========
  ui: {
    border: string;        // 普通边框
    focused: string;       // 聚焦边框
    input: string;         // 输入框
    scroll: string;        // 滚动条
  };
  
  // ========== 图标 ==========
  icons: {
    check: string;         // ✓
    cross: string;         // ✗
    arrow: string;         // →
    bullet: string;        // •
    info: string;          // ℹ
    warning: string;       // ⚠
    error: string;         // ✕
  };
}
```

### 内置主题

```typescript
// packages/tui/src/lib/themes/index.ts
export const themes: Record<string, Theme> = {
  light: lightTheme,
  dark: darkTheme,
  "dracula": draculaTheme,
  "nord": nordTheme,
  "gruvbox": gruvboxTheme,
  "solarized": solarizedTheme
};

export const lightTheme: Theme = {
  name: "light",
  colors: {
    fg: "#000000",
    bg: "#ffffff",
    primary: "#0066cc",
    secondary: "#666666",
    success: "#00aa00",
    warning: "#d4a000",
    error: "#cc0000",
    muted: "#888888",
    border: "#cccccc"
  },
  // ... 其他样式
};

export const darkTheme: Theme = {
  name: "dark",
  colors: {
    fg: "#d4d4d4",
    bg: "#1a1b26",
    primary: "#82aaff",
    secondary: "#6e7680",
    success: "#4caf50",
    warning: "#ffb74d",
    error: "#f44336",
    muted: "#525252",
    border: "#374151"
  },
  // ... 其他样式
};
```

### 主题切换

```typescript
class ThemeManager {
  private currentTheme: Theme;
  private availableThemes: Theme[];
  
  constructor(initialTheme: string) {
    this.availableThemes = Object.values(themes);
    this.currentTheme = this.getTheme(initialTheme) || darkTheme;
  }
  
  // 切换主题
  switch(themeName: string): { success: boolean; error?: string } {
    const newTheme = this.getTheme(themeName);
    if (!newTheme) {
      return {
        success: false,
        error: `Theme not found: ${themeName}`
      };
    }
    
    this.currentTheme = newTheme;
    
    // 触发主题切换事件
    this.onThemeChange?.(newTheme);
    
    return { success: true };
  }
  
  // 获取当前主题
  getCurrentTheme(): Theme {
    return this.currentTheme;
  }
}
```

---

## 核心优势

### 1. 差分渲染性能

- **极快的更新**：只重绘变化的部分，O(Δn) 复杂度
- **最小化闪烁**：避免全屏刷新
- **节省 CPU**：减少不必要的终端操作

### 2. 灵活的组件系统

- **函数式组件**：声明式 API，易于组合
- **可聚焦组件**：键盘导航支持
- **可复用**：通过组合构建复杂 UI

### 3. 强大的编辑器

- **多行编辑**：完整的文本编辑能力
- **文件引用**：@ 符号触发文件选择
- **滚动优化**：虚拟滚动，只渲染可见行
- **快捷键支持**：完整的快捷键系统

### 4. 完整的快捷键系统

- **类型安全**：KeyId 和 KeyAction 强类型
- **组合键支持**：Ctrl/Shift/Alt + 字母/数字/功能键
- **可配置**：支持自定义快捷键绑定

### 5. 消息队列 UI

- **可视化队列**：清晰显示 steering 和 follow-up 队列
- **键盘导航**：在队列中快速导航
- **队列操作**：恢复、删除、清空

### 6. 主题系统

- **多主题支持**：Light、Dark、Dracula、Nord 等
- **完整配色**：16 色主题色 + 语法高亮
- **动态切换**：运行时切换主题，立即生效

---

## 关键源码文件

- `packages/tui/src/lib/tui.ts` - TUI 核心类（2000+ 行）
- `packages/tui/src/lib/diff.ts` - 差分渲染算法（800+ 行）
- `packages/tui/src/lib/editor.ts` - 交互式编辑器（1500+ 行）
- `packages/tui/src/lib/keybindings.ts` - 快捷键系统（500+ 行）
- `packages/tui/src/lib/components/` - 基础组件（1000+ 行）
- `packages/coding-agent/src/modes/interactive/components/` - UI 组件（2000+ 行）

---

**下一步**: 深度分析 #6 跨提供商切换
