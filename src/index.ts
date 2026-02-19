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

import { EvdevDevice, type InputEvent, EV_SYN } from "./evdev";
import { findTouchpads, findGamepads, listInputDevices, isTouchpad, isGamepad } from "./device-info";
import { IdleInhibitor } from "./idle-inhibit";

interface Options {
  duration: number;
  touchpadOnly: boolean;
  gamepadOnly: boolean;
  listDevices: boolean;
  verbose: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
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

function listAllDevices(): void {
  console.log("Input Devices:\n");
  
  const devices = listInputDevices();
  const touchpads = devices.filter(isTouchpad);
  const gamepads = devices.filter(isGamepad);
  const others = devices.filter(d => !isTouchpad(d) && !isGamepad(d));

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

class InputMonitor {
  private options: Options;
  private inhibitor: IdleInhibitor;
  private devices: Map<string, EvdevDevice> = new Map();
  private monitoredPaths: Set<string> = new Set();
  private running = false;
  private scanInterval?: Timer;
  private readonly SCAN_INTERVAL_MS = 3000; // Scan for new devices every 3 seconds

  constructor(options: Options) {
    this.options = options;
    this.inhibitor = new IdleInhibitor({
      duration: options.duration,
    });
  }

  start(): void {
    // Initial device scan
    this.scanAndConnectDevices();

    if (this.devices.size === 0) {
      console.error("No input devices found to monitor!");
      console.error("Run with --list-devices to see available devices.");
      process.exit(1);
    }

    console.log(`\nIdle inhibition duration: ${this.options.duration}ms`);
    console.log(`Hotplug scanning interval: ${this.SCAN_INTERVAL_MS}ms`);
    console.log("\nPress Ctrl+C to stop.\n");

    this.running = true;

    // Start periodic device scanning for hotplug support
    this.scanInterval = setInterval(() => {
      this.scanAndConnectDevices();
      this.cleanupDisconnectedDevices();
    }, this.SCAN_INTERVAL_MS);

    // Handle graceful shutdown
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }

  private scanAndConnectDevices(): void {
    const devicesToMonitor: { path: string; name: string; type: string }[] = [];

    if (!this.options.gamepadOnly) {
      const touchpads = findTouchpads();
      for (const tp of touchpads) {
        devicesToMonitor.push({ path: tp.path, name: tp.name, type: "touchpad" });
      }
    }

    if (!this.options.touchpadOnly) {
      const gamepads = findGamepads();
      for (const gp of gamepads) {
        devicesToMonitor.push({ path: gp.path, name: gp.name, type: "gamepad" });
      }
    }

    // Connect new devices
    let newDeviceCount = 0;
    for (const devInfo of devicesToMonitor) {
      if (!this.devices.has(devInfo.path)) {
        this.connectDevice(devInfo);
        newDeviceCount++;
      }
    }

    if (newDeviceCount > 0 && this.options.verbose) {
      console.log(`[hotplug] Connected ${newDeviceCount} new device(s)`);
    }
  }

  private connectDevice(devInfo: { path: string; name: string; type: string }): void {
    const device = new EvdevDevice(devInfo.path);
    
    device.on("event", (event: InputEvent) => {
      this.handleInput(devInfo.name, event);
    });

    device.on("error", (err: Error) => {
      if (this.options.verbose) {
        console.error(`[error] ${devInfo.path}: ${err.message}`);
      }
      // Mark device for cleanup on error (likely disconnected)
      this.devices.delete(devInfo.path);
    });

    try {
      device.open();
      this.devices.set(devInfo.path, device);
      this.monitoredPaths.add(devInfo.path);
      console.log(`[connected] [${devInfo.type}] ${devInfo.path}: ${devInfo.name}`);
    } catch (err) {
      if (this.options.verbose) {
        console.error(`Failed to open ${devInfo.path}: ${err}`);
      }
    }
  }

  private cleanupDisconnectedDevices(): void {
    for (const [path, device] of this.devices) {
      if (!device.isOpen()) {
        this.devices.delete(path);
        console.log(`[disconnected] ${path}`);
      }
    }
  }

  private handleInput(deviceName: string, event: InputEvent): void {
    // Skip SYN events (synchronization events)
    if (event.type === EV_SYN) {
      return;
    }

    if (this.options.verbose) {
      const { formatEvent } = require("./evdev");
      console.log(`[input] ${deviceName}: ${formatEvent(event)}`);
    }

    // Trigger idle inhibition (fire and forget)
    this.inhibitor.inhibit().catch(() => {
      // Error already logged in inhibitor
    });
  }

  stop(): void {
    if (!this.running) return;
    
    console.log("\nShutting down...");
    this.running = false;

    // Clear scan interval
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }

    // Close all devices
    for (const device of this.devices.values()) {
      device.close();
    }
    this.devices.clear();

    // Release idle inhibition
    this.inhibitor.release().then(() => {
      console.log("Goodbye!");
      process.exit(0);
    }).catch(() => {
      console.log("Goodbye!");
      process.exit(0);
    });
  }
}

function main(): void {
  const options = parseArgs();

  if (options.listDevices) {
    listAllDevices();
    return;
  }

  const monitor = new InputMonitor(options);
  monitor.start();
}

main();
