# pi-mono TUI 终端 UI 快速扫描

**创建时间**: 2026-02-09 06:30 GMT+8
**任务编号**: #5
**类型**: 快速扫描概览

---

## 核心设计

### 差分渲染（Differential Rendering）

**原理**：只重绘变化的区域，不重绘整个屏幕

```typescript
class TUI {
  // 上一次的渲染快照
  private previousSnapshot: Map<string, ComponentState>;

  // 渲染方法
  render(component: Component): void {
    const currentSnapshot = captureState(component);

    // 计算差异
    const diff = computeDiff(previousSnapshot, currentSnapshot);

    // 只更新变化的部分
    applyDiff(diff);

    // 保存当前快照
    this.previousSnapshot = currentSnapshot;
  }
}
```

**优势**：
- 极快的渲染性能
- 减少闪烁
- 节省 CPU 资源

---

## 组件系统

### 基础组件

```typescript
// 文本组件
export function Text(props: {
  text: string;
  color?: string;
  bold?: boolean;
}): Component;

// 容器组件
export function Container(props: {
  children: Component[];
  border?: boolean;
  padding?: number;
}): Component;

// Spacer 组件
export function Spacer(props: { height: number }): Component;
```

### 交互式组件

```typescript
// 可聚焦组件
interface Focusable {
  handleInput(data: string): void;
  handleFocus(): void;
  handleBlur(): void;
}

// Input 组件（多行编辑器）
export function Input(props: {
  onChange: (text: string) => void;
  onSubmit: () => void;
}): Component;
```

---

## 交互式编辑器

### 核心功能

```typescript
class Editor implements Focusable {
  // 当前文本
  private text: string;

  // 光标位置
  private cursor: { row: number; col: number };

  // 键盘处理
  handleInput(data: string): void {
    switch (data) {
      case "Enter":
        if (!this.shiftKey) {
          this.onSubmit?.();
        } else {
          this.insertNewLine();
        }
        break;

      case "Backspace":
        this.deleteBackward();
        break;

      case "Delete":
        this.deleteForward();
        break;

      case "ArrowUp":
        this.moveUp();
        break;

      case "ArrowDown":
        this.moveDown();
        break;

      case "ArrowLeft":
        this.moveLeft();
        break;

      case "ArrowRight":
        this.moveRight();
        break;

      default:
        // 插入字符
        if (data.length === 1) {
          this.insert(data);
        }
        break;
    }
  }

  // 文件引用 (@ 符号）
  private handleFileReference(token: string): void {
    if (token.startsWith("@")) {
      // 触发文件选择
      this.showFilePicker(token.slice(1));
    }
  }

  // 多行编辑（Shift+Enter）
  insertNewLine(): void {
    this.text = this.text.slice(0, this.cursor.col) + "\n" + this.text.slice(this.cursor.col);
    this.cursor.row++;
    this.cursor.col = 0;
  }
}
```

### 文件引用 (@ 符号）

```typescript
// 触发：输入 @
handleInput("@") {
  this.showFilePicker("");
}

// 文件选择器
showFilePicker(prefix: string): void {
  const files = await findFiles(prefix);

  // 显示选择器
  const selected = await this.tui.selector(
    "Select file",
    files.map(f => f.name)
  );

  // 替换 @token 为文件内容
  this.replaceToken("@", `@${selected.path}`);
}
```

---

## 快捷键系统

### KeyId 类型

```typescript
// 键位 ID 类型
export type KeyId =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12"
  | "ctrl+a" | "ctrl+b" | "ctrl+c" | "ctrl+d" | "ctrl+e"
  | ...;
```

### 键绑定配置

```typescript
interface KeybindingsConfig {
  [action: string]: KeyId | KeyId[];

  // 应用级动作
  interrupt?: KeyId | KeyId[];
  clear?: KeyId | KeyId[];
  exit?: KeyId | KeyId[];
  submit?: KeyId;

  // 编辑器动作
  externalEditor?: KeyId;
  deleteToLineEnd?: KeyId;

  // 模型切换
  cycleModelForward?: KeyId;
  cycleModelBackward?: KeyId;
  selectModel?: KeyId;

  // 工具输出
  expandTools?: KeyId;

  // 思考级别
  cycleThinkingLevel?: KeyId;
  toggleThinking?: KeyId;
}
```

### 快捷键处理

```typescript
class KeybindingsManager {
  // 处理键盘输入
  handleInput(data: string): void {
    const keyId = data.toLowerCase() as KeyId;

    // 查找匹配的动作
    const action = this.findAction(keyId);

    if (action) {
      // 执行动作
      this.executeAction(action);
    }
  }

  private findAction(keyId: KeyId): KeyAction | undefined {
    for (const [action, keys] of Object.entries(this.config)) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      if (keyList.includes(keyId)) {
        return action as KeyAction;
      }
    }
  }
}
```

---

## 消息队列 UI

### 队列显示

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

  // 渲染队列
  renderQueue(): Component {
    const steeringItems = this.steeringQueue.map(msg => 
      this.renderMessageItem(msg, "steering")
    );

    const followUpItems = this.followUpQueue.map(msg => 
      this.renderMessageItem(msg, "follow-up")
    );

    return Container({
      border: true,
      children: [
        Text({ text: "Queue:", bold: true }),
        ...steeringItems,
        ...followUpItems
      ]
    });
  }
}
```

### 队列操作

```typescript
// 按 Enter - 提交 steering
onEnter(): void {
  const current = this.editor.getText();
  agent.steer({
    role: "user",
    content: current,
    timestamp: Date.now()
  });
}

// 按 Alt+Enter - 提交 follow-up
onAltEnter(): void {
  const current = this.editor.getText();
  agent.followUp({
    role: "user",
    content: current,
    timestamp: Date.now()
  });
}

// 按 Escape - 恢复队列消息
onEscape(): void {
  this.editor.setText(
    this.steeringQueue.shift()?.content || ""
  );
  this.steeringQueue.shift();
}
```

---

## 主题系统

### 主题结构

```typescript
interface Theme {
  // 边框颜色
  border: string;
  primary: string;
  secondary: string;
  muted: string;

  // 背景颜色
  background: string;
  surface: string;

  // 文本颜色
  text: string;
  textMuted: string;

  // 特殊
  error: string;
  warning: string;
  success: string;
}
```

### 主题切换

```typescript
// 加载主题
loadTheme(name: string): Theme | undefined {
  const themePath = findThemeFile(name);
  return JSON.parse(readFileSync(themePath));
}

// 保存主题
saveTheme(theme: Theme): void {
  writeFileSync(
    `~/.pi/agent/themes/${theme.name}.json`,
    JSON.stringify(theme, null, 2)
  );
}

// 切换主题
setTheme(theme: Theme): void {
  this.currentTheme = theme;
  this.render();  // 立即重绘
}
```

---

## 核心 API

### TUI 类

```typescript
class TUI {
  // 渲染循环
  private renderLoop(): void;

  // 组件栈
  private componentStack: Component[];

  // 事件处理
  handleInput(data: string): void;

  // 渲染组件
  render(component: Component): void;

  // 覆盖层
  showOverlay(component: Component): void;

  // 隐藏覆盖层
  hideOverlay(): void;

  // 设置大小
  resize(width: number, height: number): void;
}
```

### 组件类型

```typescript
type Component = {
  render(): string[];  // 返回渲染的行
  height?: number;    // 高度
  focusable?: boolean; // 可聚焦
};
```

---

## 核心优势

### 1. 高性能渲染
- 差分渲染：只重绘变化部分
- 最小化 DOM 操作
- 流畅的终端体验

### 2. 灵活的组件系统
- 函数式组件
- 可组合
- 易于扩展

### 3. 强大的编辑器
- 多行编辑
- 文件引用（@ 符号）
- 快捷键支持

### 4. 主题系统
- 完整的颜色配置
- JSON 格式
- 热重载

### 5. 消息队列 UI
- 可视化队列
- 支持 steering 和 follow-up
- 易于管理

---

## 关键源码文件

- `packages/tui/src/lib/components/` - 基础组件
- `packages/tui/src/lib/editor.ts` - 交互式编辑器
- `packages/tui/src/lib/keybindings.ts` - 快捷键系统
- `packages/tui/src/lib/tui.ts` - TUI 核心类
- `packages/tui/src/lib/diff.ts` - 差分渲染实现

---

**下一步**: 跨提供商切换（消息格式转换、Thinking 块处理）
