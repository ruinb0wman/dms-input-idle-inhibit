# DMS Input Idle Inhibit - Agent Guide

## Project Overview

**dms-input-idle-inhibit** is a TypeScript/Bun-based CLI tool that prevents DMS/quickshell idle screen dimming by monitoring touchpad and gamepad inputs. When input activity is detected, it sends IPC commands to DMS to temporarily inhibit idle state.

### Purpose
- Monitors Linux input devices (`/dev/input/event*`)
- Detects touchpad and gamepad/joystick activity
- Triggers DMS idle inhibition via IPC commands:
  - `dms ipc call inhibit enable` - Prevent sleep/dim
  - `dms ipc call inhibit disable` - Allow sleep/dim

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh/) |
| Language | TypeScript |
| Programming Style | Functional Programming |
| Package Manager | Bun (uses `bun.lock`) |
| Build Tool | Bun's native compiler (`bun build --compile`) |
| Target Platform | Linux (evdev subsystem) |

## Project Structure

```
.
├── src/
│   ├── index.ts         # Entry point: CLI parsing, device monitoring orchestration
│   ├── evdev.ts         # Linux evdev constants, event parsing, device functions
│   ├── device-info.ts   # Device detection via sysfs capability parsing
│   └── idle-inhibit.ts  # DMS IPC integration, inhibitor functions
├── package.json         # Project metadata and npm scripts
├── tsconfig.json        # TypeScript configuration (strict mode)
├── bun.lock            # Bun lockfile
└── README.md           # User documentation (Chinese)
```

## Module Reference

### `src/evdev.ts` - Linux Input Event Handling

**Constants:**
- Event types: `EV_SYN`, `EV_KEY`, `EV_REL`, `EV_ABS`, `EV_MSC`, ...
- Gamepad buttons: `BTN_GAMEPAD`, `BTN_SOUTH`, `BTN_EAST`, ...
- Touchpad: `BTN_TOUCH`, `BTN_TOOL_FINGER`, `ABS_X`, `ABS_Y`, ...

**Types:**
```typescript
interface InputEvent {
  sec: bigint;      // Timestamp seconds
  usec: bigint;     // Timestamp microseconds
  type: number;     // Event type (EV_*)
  code: number;     // Event code
  value: number;    // Event value
}

interface EvdevDeviceState {
  device: {
    readonly path: string;
    readonly fd: number | null;
    readonly isOpen: boolean;
    readonly isReading: boolean;
  };
  callbacks: EvdevDeviceCallbacks;
  buffer: Buffer;
}
```

**Pure Functions:**
- `createEvdevDevice(path)` - Create new device state
- `setDeviceCallbacks(state, callbacks)` - Set event/error callbacks
- `openDevice(state)` - Open device and start reading (returns new state)
- `closeDevice(state)` - Close device (returns new state)
- `isDeviceOpen(state)` - Check if device is open
- `parseEvent(buffer)` - Parse 24-byte input_event struct
- `formatEvent(event)` - Format event for display
- `getEventTypeName(type)` / `getEventCodeName(type, code)` - Get human-readable names

### `src/device-info.ts` - Device Detection

**Types:**
```typescript
interface DeviceInfo {
  path: string;
  name: string;
  capabilities: {
    ev: string;     // Event types bitmask
    key?: string;   // Key/button capabilities
    abs?: string;   // Absolute axis capabilities
    // ... other capability bitmaps
  };
}
```

**Pure Functions:**
- `listInputDevices()` - List all input devices from `/sys/class/input`
- `findTouchpads()` - Filter touchpad devices
- `findGamepads()` - Filter gamepad/joystick devices
- `isTouchpad(info)` - Check if device is a touchpad
- `isGamepad(info)` - Check if device is a gamepad
- `getDeviceName(path)` - Read device name from sysfs
- `getDeviceCapabilities(path)` - Read capability bitmaps from sysfs

### `src/idle-inhibit.ts` - DMS IPC Control

**Types:**
```typescript
interface IdleInhibitorConfig {
  duration: number;      // Duration to keep inhibited (ms)
  useToggle?: boolean;   // Use toggle mode (optional)
}

interface IdleInhibitorState {
  readonly config: IdleInhibitorConfig;
  readonly active: boolean;
  readonly dmsAvailable: boolean | null;
}
```

**Pure Functions:**
- `createInhibitor(config?)` - Create initial inhibitor state
- `inhibit(state)` - Enable idle inhibition (returns new state with active=true)
- `release(state)` - Disable idle inhibition (returns new state with active=false)
- `toggle(state)` - Toggle inhibition state
- `isInhibitorActive(state)` - Check if inhibition is active

**Note:** These functions are async due to IPC calls. The caller is responsible for:
1. Checking `state.active` before calling `inhibit()` to avoid duplicates
2. Managing the auto-release timeout externally

### `src/index.ts` - Main Application

**Types:**
```typescript
interface CliOptions {
  duration: number;
  touchpadOnly: boolean;
  gamepadOnly: boolean;
  listDevices: boolean;
  verbose: boolean;
}

interface MonitorState {
  readonly options: CliOptions;
  inhibitor: IdleInhibitorState;        // Mutable: updated by async operations
  readonly devices: Map<string, MonitoredDevice>;
  releaseTimeoutId: Timer | null;       // Mutable: for canceling timeout
  // ... other fields
}
```

**Key Functions:**
- `parseArgs()` - Parse CLI arguments
- `createInitialMonitorState(options)` - Create initial monitor state
- `getDevicesToMonitor(options)` - Get list of devices to monitor
- `scanAndConnectDevices(state, onInput, onError)` - Scan and connect new devices
- `handleInput(state, deviceName, event)` - Handle input event
- `scheduleRelease(monitorState, duration)` - Schedule auto-release timeout
- `startMonitor(options)` - Main entry point

## Functional Programming Patterns

### State Management
- **Immutable State**: State objects are readonly; updates return new objects
- **Reference Wrapper**: `monitorState: { current: MonitorState }` allows async callbacks to access latest state

```typescript
// State update pattern
monitorState.current = {
  ...monitorState.current,
  inhibitor: newInhibitor,
};
```

### Async State Handling
```typescript
// Sync check before async operation to prevent race conditions
if (monitorState.current.inhibitor.active) {
  // Already inhibiting, just reschedule
  scheduleRelease(monitorState, duration);
} else {
  // Mark as active synchronously
  monitorState.current.inhibitor = {
    ...monitorState.current.inhibitor,
    active: true,
  };
  // Then perform async operation
  const updated = await inhibit(monitorState.current.inhibitor);
  monitorState.current.inhibitor = updated;
}
```

### Side Effect Isolation
- **Pure modules** (`evdev.ts`, `device-info.ts`, `idle-inhibit.ts`): No side effects, deterministic
- **Impure layer** (`index.ts`): Contains all IO, timers, and event handlers

## Build Commands

```bash
# Install dependencies
bun install

# Development (with watch mode)
bun run dev

# Run without building
bun run start

# Build standalone executable (~65MB)
bun run build
# Output: ./dms-input-idle-inhibit
```

## CLI Options

```
Options:
  --duration, -d <ms>      Duration to keep inhibited after input (default: 5000ms)
  --touchpad-only          Only monitor touchpad devices
  --gamepad-only           Only monitor gamepad/joystick devices
  --list-devices           List all input devices and exit
  --verbose, -v            Enable verbose event logging
  --help, -h               Show help
```

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode enabled**: `strict: true` in tsconfig.json
- **Target**: ESNext with Bun's module resolution
- **Unchecked index access**: Enabled (`noUncheckedIndexedAccess: true`)

### Naming Conventions
- Functions: `camelCase` (e.g., `createEvdevDevice`, `isTouchpad`)
- Types/Interfaces: `PascalCase` (e.g., `InputEvent`, `IdleInhibitorState`)
- Constants: `UPPER_SNAKE_CASE` for evdev constants (e.g., `EV_SYN`, `BTN_GAMEPAD`)
- Pure functions should have no side effects

### Code Patterns
- Use `readonly` for immutable properties
- Use `BigInt` for 64-bit capability bitmask operations
- State updates use spread operator: `{ ...state, field: newValue }`
- Async functions return `Promise<State>` for state transitions

## Testing

**No automated test suite exists.** Testing is done manually:

1. **Device Detection**: Run `--list-devices` to verify device classification
2. **Input Monitoring**: Use `--verbose` to see live input events
3. **DMS Integration**: Verify `dms ipc call` commands work with running DMS instance

### Manual Test Checklist
- [ ] Touchpad detection works (`--list-devices` shows touchpads)
- [ ] Gamepad detection works (`--list-devices` shows gamepads)
- [ ] Input events trigger inhibition (check DMS logs)
- [ ] Timeout release works (inhibition releases after duration)
- [ ] Graceful shutdown works (Ctrl+C releases inhibition)
- [ ] No duplicate "Enabling" messages (race condition check)

## Runtime Requirements

### System Dependencies
- **Bun** runtime (for development/non-compiled runs)
- **DMS/quickshell** running with IPC support
- **Linux** with evdev input subsystem
- **Permissions**: Read access to `/dev/input/event*` (typically requires `input` group membership)

### Verify Setup
```bash
# Check DMS availability
which dms
dms ipc call inhibit enable

# Check input device access
ls -la /dev/input/event*
# Should show read permissions for user or input group
```

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "No input devices found" | No touchpad/gamepad detected | Check `--list-devices`, verify hardware |
| "dms command not found" | DMS not installed or not in PATH | Install DMS/quickshell |
| Permission denied on devices | User not in `input` group | `sudo usermod -aG input $USER` then re-login |
| Events detected but no inhibition | DMS IPC not working | Verify DMS is running, check DMS logs |
| Duplicate "Enabling" messages | Race condition in async inhibit | Already fixed in latest code (sync check before async) |

## Notes for AI Agents

- **No Class-based code**: Project uses pure functions and immutable state
- **State updates**: Always return new state objects, never mutate
- **Async race conditions**: When handling events, check state synchronously before async operations
- **Evdev constants**: Manually defined from Linux kernel headers - verify against kernel docs if adding new ones
- **Capability bitmask parsing**: Uses `BigInt` for 64+ bit masks
- **Sysfs paths**: Hardcoded to `/sys/class/input/` - these are kernel ABI and stable
- **Event structure**: 24 bytes matching `struct input_event` - do not change without kernel reference
