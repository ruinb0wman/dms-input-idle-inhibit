#!/usr/bin/env bun
/**
 * DMS Input Idle Inhibit
 *
 * A tool to prevent DMS/quickshell idle by monitoring touchpad and gamepad inputs.
 * Uses DMS IPC to control idle inhibition:
 *   dms ipc call inhibit enable
 *   dms ipc call inhibit disable
 *
 * Usage:
 *   dms-input-idle-inhibit [options]
 *
 * Options:
 *   --duration, -d     Duration to keep inhibited after input (ms, default: 5000)
 *   --touchpad-only    Only monitor touchpad devices
 *   --gamepad-only     Only monitor gamepad/joystick devices
 *   --list-devices     List all input devices and exit
 *   --verbose, -v      Enable verbose logging
 *   --help, -h         Show help
 */

import {
  type EvdevDeviceState,
  createEvdevDevice,
  setDeviceCallbacks,
  openDevice,
  closeDevice,
  isDeviceOpen,
  type InputEvent,
  EV_SYN,
  formatEvent,
} from "./evdev";
import {
  findTouchpads,
  findGamepads,
  listInputDevices,
  isTouchpad,
  isGamepad,
} from "./device-info";
import {
  type IdleInhibitorState,
  createInhibitor,
  inhibit,
  release,
} from "./idle-inhibit";

// ============================================================================
// 类型定义
// ============================================================================

interface CliOptions {
  duration: number;
  touchpadOnly: boolean;
  gamepadOnly: boolean;
  listDevices: boolean;
  verbose: boolean;
}

interface MonitoredDevice {
  readonly path: string;
  readonly name: string;
  readonly type: "touchpad" | "gamepad";
  readonly state: EvdevDeviceState;
}

interface MonitorState {
  readonly options: CliOptions;
  inhibitor: IdleInhibitorState; // 可变：定时器需要更新这个
  readonly devices: ReadonlyMap<string, MonitoredDevice>;
  readonly monitoredPaths: ReadonlySet<string>;
  readonly running: boolean;
  releaseTimeoutId: Timer | null; // 可变：用于取消定时
}

// ============================================================================
// CLI 参数解析
// ============================================================================

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    duration: 5000,
    touchpadOnly: false,
    gamepadOnly: false,
    listDevices: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--duration":
      case "-d": {
        const val = args[++i];
        if (val) options.duration = parseInt(val, 10);
        break;
      }
      case "--touchpad-only":
        options.touchpadOnly = true;
        break;
      case "--gamepad-only":
        options.gamepadOnly = true;
        break;
      case "--list-devices":
        options.listDevices = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
DMS Input Idle Inhibit

Prevents DMS/quickshell idle by monitoring touchpad and gamepad inputs.
Uses DMS IPC to control idle inhibition.

Usage: dms-input-idle-inhibit [options]

Options:
  --duration, -d <ms>      Duration to keep inhibited after input (default: 5000)
  --touchpad-only          Only monitor touchpad devices
  --gamepad-only           Only monitor gamepad/joystick devices
  --list-devices           List all input devices and exit
  --verbose, -v            Enable verbose logging
  --help, -h               Show this help

Examples:
  # Basic usage
  dms-input-idle-inhibit

  # Only monitor gamepads for 10 seconds
  dms-input-idle-inhibit --gamepad-only --duration 10000

  # List all input devices
  dms-input-idle-inhibit --list-devices

Requirements:
  - DMS (quickshell) must be running
  - 'dms' command must be in PATH
  - User must have access to /dev/input/event* devices
`);
}

// ============================================================================
// 设备列表功能
// ============================================================================

function listAllDevices(): void {
  console.log("Input Devices:\n");

  const devices = listInputDevices();
  const touchpads = devices.filter(isTouchpad);
  const gamepads = devices.filter(isGamepad);
  const others = devices.filter((d) => !isTouchpad(d) && !isGamepad(d));

  console.log("=== Touchpads ===");
  for (const device of touchpads) {
    console.log(`  ${device.path}: ${device.name}`);
  }
  console.log();

  console.log("=== Gamepads/Joysticks ===");
  for (const device of gamepads) {
    console.log(`  ${device.path}: ${device.name}`);
  }
  console.log();

  console.log("=== Other Devices ===");
  for (const device of others) {
    console.log(`  ${device.path}: ${device.name}`);
  }
}

// ============================================================================
// 设备扫描与连接
// ============================================================================

interface DeviceToMonitor {
  readonly path: string;
  readonly name: string;
  readonly type: "touchpad" | "gamepad";
}

function getDevicesToMonitor(options: CliOptions): DeviceToMonitor[] {
  const devices: DeviceToMonitor[] = [];

  if (!options.gamepadOnly) {
    const touchpads = findTouchpads();
    for (const tp of touchpads) {
      devices.push({ path: tp.path, name: tp.name, type: "touchpad" });
    }
  }

  if (!options.touchpadOnly) {
    const gamepads = findGamepads();
    for (const gp of gamepads) {
      devices.push({ path: gp.path, name: gp.name, type: "gamepad" });
    }
  }

  return devices;
}

function connectDevice(
  devInfo: DeviceToMonitor,
  options: CliOptions,
  onInput: (deviceName: string, event: InputEvent) => void,
  onDeviceError: (path: string) => void
): MonitoredDevice | null {
  let deviceState = createEvdevDevice(devInfo.path);

  deviceState = setDeviceCallbacks(deviceState, {
    onEvent: (event: InputEvent) => onInput(devInfo.name, event),
    onError: () => onDeviceError(devInfo.path),
  });

  try {
    deviceState = openDevice(deviceState);

    if (options.verbose) {
      console.log(
        `[connected] [${devInfo.type}] ${devInfo.path}: ${devInfo.name}`
      );
    }

    return {
      path: devInfo.path,
      name: devInfo.name,
      type: devInfo.type,
      state: deviceState,
    };
  } catch (err) {
    if (options.verbose) {
      console.error(`Failed to open ${devInfo.path}: ${err}`);
    }
    return null;
  }
}

function scanAndConnectDevices(
  state: MonitorState,
  onInput: (deviceName: string, event: InputEvent) => void,
  onDeviceError: (path: string) => void
): MonitorState {
  const devicesToMonitor = getDevicesToMonitor(state.options);
  const newDevices = new Map(state.devices);
  const newMonitoredPaths = new Set(state.monitoredPaths);

  let newDeviceCount = 0;

  for (const devInfo of devicesToMonitor) {
    if (!newDevices.has(devInfo.path)) {
      const device = connectDevice(
        devInfo,
        state.options,
        onInput,
        onDeviceError
      );

      if (device) {
        newDevices.set(devInfo.path, device);
        newMonitoredPaths.add(devInfo.path);
        newDeviceCount++;
      }
    }
  }

  if (newDeviceCount > 0 && state.options.verbose) {
    console.log(`[hotplug] Connected ${newDeviceCount} new device(s)`);
  }

  return {
    ...state,
    devices: newDevices,
    monitoredPaths: newMonitoredPaths,
  };
}

function cleanupDisconnectedDevices(state: MonitorState): MonitorState {
  const newDevices = new Map(state.devices);

  for (const [path, device] of state.devices) {
    if (!isDeviceOpen(device.state)) {
      newDevices.delete(path);
      console.log(`[disconnected] ${path}`);
    }
  }

  return {
    ...state,
    devices: newDevices,
  };
}

// ============================================================================
// 输入处理
// ============================================================================

function handleInput(
  state: MonitorState,
  deviceName: string,
  event: InputEvent
): { newState: MonitorState; shouldInhibit: boolean } {
  // Skip SYN events (synchronization events)
  if (event.type === EV_SYN) {
    return { newState: state, shouldInhibit: false };
  }

  if (state.options.verbose) {
    console.log(`[input] ${deviceName}: ${formatEvent(event)}`);
  }

  return { newState: state, shouldInhibit: true };
}

// ============================================================================
// Monitor 生命周期管理
// ============================================================================

const SCAN_INTERVAL_MS = 3000;

function createInitialMonitorState(options: CliOptions): MonitorState {
  return {
    options,
    inhibitor: createInhibitor({ duration: options.duration }),
    devices: new Map(),
    monitoredPaths: new Set(),
    running: false,
    releaseTimeoutId: null,
  };
}

function setMonitorRunning(
  state: MonitorState,
  running: boolean
): MonitorState {
  return {
    ...state,
    running,
  };
}

/**
 * 清除现有的释放定时器
 */
function clearReleaseTimeout(state: MonitorState): void {
  if (state.releaseTimeoutId) {
    clearTimeout(state.releaseTimeoutId);
    state.releaseTimeoutId = null;
  }
}

/**
 * 调度释放 idle inhibition
 * 使用闭包捕获 monitorState 引用，确保能访问最新状态
 */
function scheduleRelease(
  monitorState: { current: MonitorState },
  duration: number
): void {
  // 清除现有定时器
  clearReleaseTimeout(monitorState.current);

  // 设置新的定时器
  monitorState.current.releaseTimeoutId = setTimeout(() => {
    release(monitorState.current.inhibitor).then((newInhibitor) => {
      monitorState.current.inhibitor = newInhibitor;
      monitorState.current.releaseTimeoutId = null;
    });
  }, duration);
}

async function startMonitor(options: CliOptions): Promise<void> {
  // 使用引用对象，让定时器回调能访问最新状态
  const monitorState: { current: MonitorState } = {
    current: createInitialMonitorState(options),
  };

  // 输入事件处理器
  const onInput = async (deviceName: string, event: InputEvent) => {
    const { newState, shouldInhibit } = handleInput(
      monitorState.current,
      deviceName,
      event
    );

    // 更新状态（devices 等）
    monitorState.current = {
      ...monitorState.current,
      devices: newState.devices,
      monitoredPaths: newState.monitoredPaths,
    };

    if (shouldInhibit) {
      // 先同步检查并避免重复触发
      if (monitorState.current.inhibitor.active) {
        // 已经在抑制中，只需重新调度定时器
        scheduleRelease(monitorState, options.duration);
      } else {
        // 需要先同步设置 active 标志，防止并发调用
        // 创建一个临时 "pending" 状态来表示正在启动中
        monitorState.current.inhibitor = {
          ...monitorState.current.inhibitor,
          active: true, // 先标记为 true，防止其他事件重复触发
        };

        // 启动 inhibition
        const updatedInhibitor = await inhibit(monitorState.current.inhibitor);
        monitorState.current.inhibitor = updatedInhibitor;

        // 调度自动释放
        scheduleRelease(monitorState, options.duration);
      }
    }
  };

  // 设备错误处理器
  const onDeviceError = (path: string) => {
    const newDevices = new Map(monitorState.current.devices);
    newDevices.delete(path);
    monitorState.current = {
      ...monitorState.current,
      devices: newDevices,
    };
  };

  // 初始设备扫描
  monitorState.current = scanAndConnectDevices(
    monitorState.current,
    onInput,
    onDeviceError
  );

  if (monitorState.current.devices.size === 0) {
    console.error("No input devices found to monitor!");
    console.error("Run with --list-devices to see available devices.");
    process.exit(1);
  }

  console.log(`\nIdle inhibition duration: ${options.duration}ms`);
  console.log(`Hotplug scanning interval: ${SCAN_INTERVAL_MS}ms`);
  console.log("\nPress Ctrl+C to stop.\n");

  monitorState.current = setMonitorRunning(monitorState.current, true);

  // 启动定期设备扫描（热插拔支持）
  const intervalId = setInterval(() => {
    monitorState.current = scanAndConnectDevices(
      monitorState.current,
      onInput,
      onDeviceError
    );
    monitorState.current = cleanupDisconnectedDevices(monitorState.current);
  }, SCAN_INTERVAL_MS);

  // 处理优雅关闭
  const shutdown = async () => {
    console.log("\nShutting down...");

    // 清除扫描定时器
    clearInterval(intervalId);

    // 清除释放定时器
    clearReleaseTimeout(monitorState.current);

    // 关闭所有设备
    for (const device of monitorState.current.devices.values()) {
      closeDevice(device.state);
    }

    // 释放 idle inhibition
    await release(monitorState.current.inhibitor);

    console.log("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ============================================================================
// 主入口
// ============================================================================

function main(): void {
  const options = parseArgs();

  if (options.listDevices) {
    listAllDevices();
    return;
  }

  startMonitor(options);
}

main();
