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
| Package Manager | Bun (uses `bun.lock`) |
| Build Tool | Bun's native compiler (`bun build --compile`) |
| Target Platform | Linux (evdev subsystem) |

## Project Structure

```
.
├── src/
│   ├── index.ts         # Entry point: CLI parsing, InputMonitor orchestration
│   ├── evdev.ts         # Linux evdev constants, event parsing, EvdevDevice class
│   ├── device-info.ts   # Device detection via sysfs capability parsing
│   └── idle-inhibit.ts  # DMS IPC integration, IdleInhibitor class
├── package.json         # Project metadata and npm scripts
├── tsconfig.json        # TypeScript configuration (strict mode)
├── bun.lock            # Bun lockfile
└── README.md           # User documentation (Chinese)
```

### Module Responsibilities

#### `src/index.ts`
- CLI argument parsing (`parseArgs()`)
- `InputMonitor` class: orchestrates device monitoring and idle inhibition
  - Device discovery and filtering
  - Event routing from devices to inhibitor
  - Graceful shutdown handling (SIGINT/SIGTERM)

#### `src/evdev.ts`
- Linux input event constants (EV_SYN, EV_KEY, EV_ABS, BTN_*)
- Event structure parsing (24-byte `input_event` struct)
- `EvdevDevice` class: EventEmitter-based async device reader
  - Opens `/dev/input/event*` files
  - Emits parsed `InputEvent` objects

#### `src/device-info.ts`
- Device capability parsing from `/sys/class/input/`
- `isTouchpad()`: Detects touchpads by name patterns and ABS + BTN_TOUCH capabilities
- `isGamepad()`: Detects gamepads by name patterns and BTN_JOYSTICK/BTN_GAMEPAD capabilities
- `listInputDevices()`: Enumerates all input devices

#### `src/idle-inhibit.ts`
- `IdleInhibitor` class: Manages DMS idle inhibition state
  - `inhibit()`: Enables inhibition with auto-release timeout
  - `release()`: Disables inhibition immediately
  - Checks `dms` command availability on first use

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
- **Unused locals/parameters**: NOT enforced (set to `false`)

### Naming Conventions
- Classes: `PascalCase` (e.g., `EvdevDevice`, `IdleInhibitor`)
- Interfaces: `PascalCase` (e.g., `InputEvent`, `DeviceInfo`)
- Constants: `UPPER_SNAKE_CASE` for evdev constants (e.g., `EV_SYN`, `BTN_GAMEPAD`)
- Functions: `camelCase` (e.g., `parseEvent`, `isTouchpad`)
- Private methods: `camelCase` with `private` modifier

### Code Patterns
- Use `BigInt` for 64-bit capability bitmask operations
- Event-driven architecture using Node.js `EventEmitter`
- Async/await for subprocess spawning (DMS IPC)
- Synchronous file operations for sysfs reads (simple/small files)

### Error Handling
- Try-catch blocks for filesystem operations
- Error events emitted from `EvdevDevice` (non-fatal)
- Console error logging for DMS command failures
- Graceful degradation when devices cannot be opened

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

## Security Considerations

1. **Input Device Access**: Requires reading from `/dev/input/event*` devices. The compiled binary or Bun process must have appropriate permissions (user in `input` group, or running as root - not recommended).

2. **DMS IPC**: Executes `dms` command via `child_process.spawn()`. No shell interpolation is used, but ensure `dms` binary is the expected one (not a malicious replacement in PATH).

3. **No Network**: Tool does not open network connections; purely local IPC and input device access.

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "No input devices found" | No touchpad/gamepad detected | Check `--list-devices`, verify hardware |
| "dms command not found" | DMS not installed or not in PATH | Install DMS/quickshell |
| Permission denied on devices | User not in `input` group | `sudo usermod -aG input $USER` then re-login |
| Events detected but no inhibition | DMS IPC not working | Verify DMS is running, check DMS logs |

## Development Workflow

1. Make changes to TypeScript source files
2. Test with `bun run dev -- --verbose --list-devices`
3. Test actual inhibition with `bun run dev -- --verbose --duration 10000`
4. Build for distribution: `bun run build`
5. Test compiled binary: `./dms-input-idle-inhibit --list-devices`

## Notes for AI Agents

- **Do not assume Jest/Vitest testing** - project has no test framework
- **Evdev constants** are manually defined from Linux kernel headers - verify against kernel docs if adding new ones
- **Capability bitmask parsing** uses `BigInt` for 64+ bit masks - maintain this for new capability checks
- **Sysfs paths** are hardcoded to `/sys/class/input/` - these are kernel ABI and stable
- **Event structure** (24 bytes) matches `struct input_event` - do not change without kernel reference
- Comments and documentation are primarily in **Chinese** - maintain this for user-facing docs
