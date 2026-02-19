/**
 * Linux evdev input event handling
 * References:
 * - https://www.kernel.org/doc/Documentation/input/input.txt
 * - https://www.kernel.org/doc/Documentation/input/event-codes.txt
 */

import * as fs from "fs";
import { EventEmitter } from "events";

// Evdev event structure (24 bytes on 64-bit systems)
// struct input_event {
//     struct timeval time;  // 16 bytes (tv_sec + tv_usec)
//     __u16 type;           // 2 bytes
//     __u16 code;           // 2 bytes
//     __s32 value;          // 4 bytes
// };

// Event types
export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_REL = 0x02;
export const EV_ABS = 0x03;
export const EV_MSC = 0x04;
export const EV_SW = 0x05;
export const EV_LED = 0x11;
export const EV_SND = 0x12;
export const EV_REP = 0x14;
export const EV_FF = 0x15;
export const EV_PWR = 0x16;
export const EV_FF_STATUS = 0x17;

// Synchronization events
export const SYN_REPORT = 0;
export const SYN_CONFIG = 1;
export const SYN_MT_REPORT = 2;
export const SYN_DROPPED = 3;

// Absolute axes (for touchpads)
export const ABS_X = 0x00;
export const ABS_Y = 0x01;
export const ABS_Z = 0x02;
export const ABS_RX = 0x03;
export const ABS_RY = 0x04;
export const ABS_RZ = 0x05;
export const ABS_MT_SLOT = 0x2f;
export const ABS_MT_TOUCH_MAJOR = 0x30;
export const ABS_MT_TOUCH_MINOR = 0x31;
export const ABS_MT_WIDTH_MAJOR = 0x32;
export const ABS_MT_WIDTH_MINOR = 0x33;
export const ABS_MT_ORIENTATION = 0x34;
export const ABS_MT_POSITION_X = 0x35;
export const ABS_MT_POSITION_Y = 0x36;
export const ABS_MT_TRACKING_ID = 0x39;
export const ABS_MT_PRESSURE = 0x3a;

// Keys/BTN for gamepads/joysticks
export const BTN_JOYSTICK = 0x120;
export const BTN_TRIGGER = 0x120;
export const BTN_THUMB = 0x121;
export const BTN_THUMB2 = 0x122;
export const BTN_TOP = 0x123;
export const BTN_TOP2 = 0x124;
export const BTN_PINKIE = 0x125;
export const BTN_BASE = 0x126;
export const BTN_BASE2 = 0x127;
export const BTN_BASE3 = 0x128;
export const BTN_BASE4 = 0x129;
export const BTN_BASE5 = 0x12a;
export const BTN_BASE6 = 0x12b;
export const BTN_DEAD = 0x12f;

export const BTN_GAMEPAD = 0x130;
export const BTN_SOUTH = 0x130;
export const BTN_A = BTN_SOUTH;
export const BTN_EAST = 0x131;
export const BTN_B = BTN_EAST;
export const BTN_C = 0x132;
export const BTN_NORTH = 0x133;
export const BTN_X = BTN_NORTH;
export const BTN_WEST = 0x134;
export const BTN_Y = BTN_WEST;
export const BTN_Z = 0x135;
export const BTN_TL = 0x136;
export const BTN_TR = 0x137;
export const BTN_TL2 = 0x138;
export const BTN_TR2 = 0x139;
export const BTN_SELECT = 0x13a;
export const BTN_MODE = 0x13b;
export const BTN_START = 0x13c;
export const BTN_THUMBL = 0x13d;
export const BTN_THUMBR = 0x13e;

export const BTN_DIGI = 0x140;
export const BTN_TOOL_PEN = 0x140;
export const BTN_TOOL_RUBBER = 0x141;
export const BTN_TOOL_BRUSH = 0x142;
export const BTN_TOOL_PENCIL = 0x143;
export const BTN_TOOL_AIRBRUSH = 0x144;
export const BTN_TOOL_FINGER = 0x145;
export const BTN_TOOL_MOUSE = 0x146;
export const BTN_TOOL_LENS = 0x147;
export const BTN_TOOL_QUINTTAP = 0x148;
export const BTN_STYLUS3 = 0x149;
export const BTN_TOUCH = 0x14a;
export const BTN_STYLUS = 0x14b;
export const BTN_STYLUS2 = 0x14c;
export const BTN_TOOL_DOUBLETAP = 0x14d;
export const BTN_TOOL_TRIPLETAP = 0x14e;
export const BTN_TOOL_QUADTAP = 0x14f;

export const BTN_WHEEL = 0x150;
export const BTN_GEAR_DOWN = 0x150;
export const BTN_GEAR_UP = 0x151;

export interface InputEvent {
  sec: bigint;
  usec: bigint;
  type: number;
  code: number;
  value: number;
}

export function parseEvent(buffer: Buffer): InputEvent {
  // Read timeval (16 bytes)
  const sec = buffer.readBigInt64LE(0);
  const usec = buffer.readBigInt64LE(8);

  // Read type, code, value (8 bytes total)
  const type = buffer.readUInt16LE(16);
  const code = buffer.readUInt16LE(18);
  const value = buffer.readInt32LE(20);

  return { sec, usec, type, code, value };
}

export function formatEvent(ev: InputEvent): string {
  const typeName = getEventTypeName(ev.type);
  const codeName = getEventCodeName(ev.type, ev.code);
  return `${typeName}(${codeName}) = ${ev.value}`;
}

export function getEventTypeName(type: number): string {
  switch (type) {
    case EV_SYN:
      return "SYN";
    case EV_KEY:
      return "KEY";
    case EV_REL:
      return "REL";
    case EV_ABS:
      return "ABS";
    case EV_MSC:
      return "MSC";
    case EV_SW:
      return "SW";
    case EV_LED:
      return "LED";
    case EV_SND:
      return "SND";
    case EV_REP:
      return "REP";
    case EV_FF:
      return "FF";
    case EV_PWR:
      return "PWR";
    case EV_FF_STATUS:
      return "FF_STATUS";
    default:
      return `TYPE_${type.toString(16)}`;
  }
}

export function getEventCodeName(type: number, code: number): string {
  if (type === EV_ABS) {
    switch (code) {
      case ABS_X:
        return "X";
      case ABS_Y:
        return "Y";
      case ABS_Z:
        return "Z";
      case ABS_RX:
        return "RX";
      case ABS_RY:
        return "RY";
      case ABS_RZ:
        return "RZ";
      case ABS_MT_SLOT:
        return "MT_SLOT";
      case ABS_MT_TOUCH_MAJOR:
        return "MT_TOUCH_MAJOR";
      case ABS_MT_TOUCH_MINOR:
        return "MT_TOUCH_MINOR";
      case ABS_MT_POSITION_X:
        return "MT_POSITION_X";
      case ABS_MT_POSITION_Y:
        return "MT_POSITION_Y";
      case ABS_MT_TRACKING_ID:
        return "MT_TRACKING_ID";
      case ABS_MT_PRESSURE:
        return "MT_PRESSURE";
      default:
        return `ABS_${code.toString(16)}`;
    }
  }
  if (type === EV_KEY) {
    if (code >= BTN_JOYSTICK && code <= BTN_DEAD) {
      return `JOY_${code - BTN_JOYSTICK}`;
    }
    if (code >= BTN_GAMEPAD && code <= BTN_THUMBR) {
      const names: Record<number, string> = {
        [BTN_SOUTH]: "A",
        [BTN_EAST]: "B",
        [BTN_C]: "C",
        [BTN_NORTH]: "X",
        [BTN_WEST]: "Y",
        [BTN_Z]: "Z",
        [BTN_TL]: "TL",
        [BTN_TR]: "TR",
        [BTN_TL2]: "TL2",
        [BTN_TR2]: "TR2",
        [BTN_SELECT]: "SELECT",
        [BTN_MODE]: "MODE",
        [BTN_START]: "START",
        [BTN_THUMBL]: "THUMBL",
        [BTN_THUMBR]: "THUMBR",
      };
      return names[code] || `BTN_${code.toString(16)}`;
    }
    if (code >= BTN_DIGI && code <= 0x14f) {
      const names: Record<number, string> = {
        [BTN_TOOL_PEN]: "TOOL_PEN",
        [BTN_TOOL_FINGER]: "TOOL_FINGER",
        [BTN_TOOL_MOUSE]: "TOOL_MOUSE",
        [BTN_TOUCH]: "TOUCH",
        [BTN_TOOL_DOUBLETAP]: "DOUBLETAP",
        [BTN_TOOL_TRIPLETAP]: "TRIPLETAP",
        [BTN_TOOL_QUADTAP]: "QUADTAP",
        [BTN_TOOL_QUINTTAP]: "QUINTTAP",
      };
      return names[code] || `DIGI_${code.toString(16)}`;
    }
    return `KEY_${code}`;
  }
  if (type === EV_SYN) {
    switch (code) {
      case SYN_REPORT:
        return "REPORT";
      case SYN_CONFIG:
        return "CONFIG";
      case SYN_MT_REPORT:
        return "MT_REPORT";
      case SYN_DROPPED:
        return "DROPPED";
      default:
        return `SYN_${code}`;
    }
  }
  return `${code}`;
}

export class EvdevDevice extends EventEmitter {
  private fd: number | null = null;
  private buffer: Buffer;
  private devicePath: string;
  private reading = false;
  private openFlag = false;

  constructor(devicePath: string) {
    super();
    this.devicePath = devicePath;
    this.buffer = Buffer.alloc(24);
  }

  get path(): string {
    return this.devicePath;
  }

  isOpen(): boolean {
    return this.openFlag && this.fd !== null && this.reading;
  }

  open(): void {
    if (this.fd !== null) return;

    this.fd = fs.openSync(this.devicePath, "r");
    this.reading = true;
    this.openFlag = true;
    this.doRead();
  }

  close(): void {
    this.reading = false;
    this.openFlag = false;
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // Ignore close errors
      }
      this.fd = null;
    }
  }

  private doRead(): void {
    if (!this.reading || this.fd === null) return;

    fs.read(this.fd, this.buffer, 0, 24, null, (err, bytesRead) => {
      if (err) {
        this.openFlag = false;
        this.emit("error", err);
        return;
      }

      if (bytesRead === 0) {
        // Device disconnected (EOF)
        this.openFlag = false;
        this.emit("error", new Error("Device disconnected (EOF)"));
        return;
      }

      if (bytesRead === 24) {
        const event = parseEvent(this.buffer);
        this.emit("event", event);
      }

      // Continue reading
      this.doRead();
    });
  }
}
