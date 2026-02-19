# DMS Input Idle Inhibit

一个使用 Bun + TypeScript 编写的工具，采用**函数式编程风格**，用于监听触摸板和手柄操作，通过 DMS IPC 防止 quickshell idle 后熄屏。

## 功能

- 自动检测并监听触摸板设备
- 自动检测并监听游戏手柄/摇杆设备
- 检测到输入时通过 DMS IPC 自动启用 idle inhibition
- 可配置抑制持续时间（默认 5 秒）
- 热插拔支持：动态检测新连接的设备

## 工作原理

通过 DMS IPC 命令控制 idle inhibition：

```bash
# 启用 idle inhibit（阻止睡眠/熄屏）
dms ipc call inhibit enable

# 禁用 idle inhibit（允许睡眠/熄屏）
dms ipc call inhibit disable
```

当检测到触摸板或手柄输入时，程序会：
1. 调用 `dms ipc call inhibit enable` 阻止熄屏
2. 启动定时器，在指定时间后调用 `dms ipc call inhibit disable`
3. 如果期间有新的输入，重置定时器

## 安装

### 前置要求

- DMS (quickshell) 必须正在运行
- Linux 系统（需要访问 `/dev/input/event*`）
- 用户需要在 `input` 组以访问输入设备

### 安装步骤

```bash
# 进入项目目录
cd dms-input-idle-inhibit

# 安装依赖
bun install

# 可选：编译为独立可执行文件
bun run build

# 将编译后的文件移动到 PATH 中
sudo cp dms-input-idle-inhibit /usr/local/bin/
```

## 使用方法

### 基本使用

```bash
# 直接运行
bun run start

# 或使用编译后的版本
dms-input-idle-inhibit
```

### 命令行选项

```
Options:
  --duration, -d <ms>      输入后保持抑制的持续时间（毫秒，默认: 5000）
  --touchpad-only          只监听触摸板设备
  --gamepad-only           只监听手柄/摇杆设备
  --list-devices           列出所有输入设备并退出
  --verbose, -v            启用详细日志
  --help, -h               显示帮助
```

### 示例

```bash
# 列出所有设备
bun run start -- --list-devices

# 只监听手柄，抑制10秒
bun run start -- --gamepad-only --duration 10000

# 启用详细日志（显示所有输入事件）
bun run start -- --verbose
```

### niri

配置示例

```
spawn-at-startup "dms-input-idle-inhibit" "-d" "60000"
```


## 项目架构

### 技术栈
- **运行时**: [Bun](https://bun.sh/)
- **语言**: TypeScript (严格模式)
- **编程范式**: 函数式编程（纯函数、不可变状态）

### 目录结构
```
src/
├── index.ts         # 主程序：CLI 解析、状态管理、事件处理
├── evdev.ts         # Linux evdev 输入事件处理（纯函数）
├── device-info.ts   # 设备检测与识别（纯函数）
└── idle-inhibit.ts  # DMS IPC 控制（纯函数）
```

### 核心模块

#### evdev.ts - 输入事件处理
提供函数式接口操作 evdev 设备：

```typescript
// 创建设备状态
const device = createEvdevDevice("/dev/input/event5");

// 设置回调
const withCallbacks = setDeviceCallbacks(device, {
  onEvent: (event) => console.log(event),
  onError: (err) => console.error(err),
});

// 打开设备（返回新状态）
const opened = openDevice(withCallbacks);
```

#### device-info.ts - 设备检测
从 sysfs 读取设备信息，识别触摸板和手柄：

```typescript
// 列出所有设备
const devices = listInputDevices();

// 过滤触摸板
const touchpads = devices.filter(isTouchpad);

// 过滤手柄
const gamepads = devices.filter(isGamepad);
```

#### idle-inhibit.ts - DMS IPC 控制
管理 DMS idle inhibition 状态：

```typescript
// 创建初始状态
let inhibitor = createInhibitor({ duration: 5000 });

// 启用抑制（异步，返回新状态）
inhibitor = await inhibit(inhibitor);

// 禁用抑制（异步，返回新状态）
inhibitor = await release(inhibitor);
```



## 设备检测

程序启动时扫描 `/dev/input/event*` 设备，根据以下条件识别：

### 触摸板检测
通过以下方式识别：
1. 设备名称包含 "touchpad" 或 "trackpad"
2. 或设备能力检查：
   - 支持绝对坐标 (`EV_ABS`)
   - 有 `ABS_X` 和 `ABS_Y` 轴
   - 有触摸能力 (`BTN_TOUCH` 或 `BTN_TOOL_FINGER`)
   - 排除明显的手柄（名称不含 "joystick"、"gamepad" 等）

### 手柄/摇杆检测
通过以下方式识别：
1. 设备名称包含 "gamepad"、"joystick"、"controller" 或 "joy"
2. 或设备能力检查：
   - 有游戏手柄按钮 (`BTN_JOYSTICK` 或 `BTN_GAMEPAD`)
   - 或有 A 按钮 (`BTN_SOUTH`)

## 开发

### 函数式编程风格

本项目采用函数式编程范式：

- **纯函数**: 相同输入总是产生相同输出，无副作用
- **不可变状态**: 状态更新返回新对象，不修改原对象
- **显式状态传递**: 状态作为参数传入，新状态作为返回值传出

示例：
```typescript
// 不可变状态更新
const newState = {
  ...oldState,
  inhibitor: {
    ...oldState.inhibitor,
    active: true,
  },
};

// 异步状态管理使用引用包装
const monitorState = { current: initialState };

// 在回调中更新状态
monitorState.current.inhibitor = await inhibit(monitorState.current.inhibitor);
```

### 构建命令

```bash
# 开发模式（热重载）
bun run dev

# 运行
bun run start

# 构建独立可执行文件
bun run build
```

## 故障排除

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 无输入设备 | 运行 `--list-devices` 检查设备识别 |
| 权限被拒绝 | 将用户加入 `input` 组: `sudo usermod -aG input $USER`，然后重新登录 |
| DMS 命令未找到 | 确保 DMS/quickshell 已安装且在 PATH 中 |
| 事件检测但无抑制 | 检查 DMS 是否正在运行，查看 DMS 日志 |

### 调试

使用 `--verbose` 选项查看详细日志：

```bash
bun run start -- --verbose
```

输出示例：
```
[connected] [touchpad] /dev/input/event5: BLTP7853:00 347D:7853 Touchpad
[input] BLTP7853:00 347D:7853 Touchpad: ABS(MT_POSITION_X) = 1234
[idle-inhibit] Enabling DMS idle inhibition
[input] BLTP7853:00 347D:7853 Touchpad: ABS(MT_POSITION_Y) = 567
[input] BLTP7853:00 347D:7853 Touchpad: SYN(REPORT) = 0
[idle-inhibit] Disabling DMS idle inhibition
```

## 注意事项

- 需要 DMS (quickshell) 正在运行
- 需要 `dms` 命令在 PATH 中
- 需要读取 `/dev/input/event*` 的权限（通常在 `input` 组中）
- 详细日志模式会输出所有输入事件，可能影响性能
- 一个触摸板操作会产生多个事件，程序已做防抖处理

## 许可证

MIT
