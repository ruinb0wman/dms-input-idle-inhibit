# DMS Input Idle Inhibit

一个使用 Bun 编写的工具，用于监听触摸板和手柄操作，通过 DMS IPC 防止 quickshell idle 后熄屏。

## 功能

- 自动检测并监听触摸板设备
- 自动检测并监听游戏手柄/摇杆设备
- 检测到输入时通过 DMS IPC 自动启用 idle inhibition
- 可配置抑制持续时间

## 工作原理

通过 DMS IPC 命令控制 idle inhibition：

```bash
# 启用 idle inhibit（阻止睡眠/熄屏）
dms ipc call inhibit enable

# 禁用 idle inhibit（允许睡眠/熄屏）
dms ipc call inhibit disable
```

## 安装

### 前置要求

- [Bun](https://bun.sh/) 运行时
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

# 启用详细日志
bun run start -- --verbose
```

### 作为 systemd 用户服务运行

创建 `~/.config/systemd/user/dms-input-idle-inhibit.service`：

```ini
[Unit]
Description=DMS Input Idle Inhibit
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/local/bin/dms-input-idle-inhibit
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

启用并启动服务：

```bash
systemctl --user daemon-reload
systemctl --user enable dms-input-idle-inhibit
systemctl --user start dms-input-idle-inhibit
```

## 设备检测

程序启动时扫描 `/dev/input/event*` 设备，根据以下条件识别：

### 触摸板
- 设备名称包含 "touchpad" 或 "trackpad"
- 或设备有绝对坐标 (ABS_X/ABS_Y) 和触摸能力 (BTN_TOUCH/BTN_TOOL_FINGER)

### 手柄/摇杆
- 设备名称包含 "gamepad"、"joystick"、"controller" 或 "joy"
- 或设备有游戏手柄按钮 (BTN_JOYSTICK 或 BTN_GAMEPAD)

## 注意事项

- 需要 DMS (quickshell) 正在运行
- 需要 `dms` 命令在 PATH 中
- 需要读取 `/dev/input/event*` 的权限（通常在 `input` 组中）
- 详细日志模式会输出所有输入事件，可能影响性能

## 许可证

MIT
