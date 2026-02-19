/**
 * Device information parsing from /sys/class/input
 */

import * as fs from "fs";
import * as path from "path";

export interface DeviceInfo {
  path: string;
  name: string;
  phys: string;
  id: string;
  handlers: string[];
  capabilities: {
    ev: string;
    key?: string;
    rel?: string;
    abs?: string;
    msc?: string;
    sw?: string;
    led?: string;
    snd?: string;
    ff?: string;
  };
}

/**
 * Read device name from sysfs
 */
export function getDeviceName(devicePath: string): string {
  try {
    const sysPath = devicePath.replace("/dev/input/", "/sys/class/input/");
    const namePath = path.join(sysPath, "device/name");
    if (fs.existsSync(namePath)) {
      return fs.readFileSync(namePath, "utf-8").trim();
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Get device capabilities from sysfs
 */
export function getDeviceCapabilities(devicePath: string): DeviceInfo["capabilities"] {
  const caps: DeviceInfo["capabilities"] = { ev: "" };
  try {
    const sysPath = devicePath.replace("/dev/input/", "/sys/class/input/");
    const deviceDir = path.join(sysPath, "device");
    
    // Read bitmap files
    const bitmapFiles = ["ev", "key", "rel", "abs", "msc", "sw", "led", "snd", "ff"];
    for (const bit of bitmapFiles) {
      const bitPath = path.join(deviceDir, `capabilities/${bit}`);
      if (fs.existsSync(bitPath)) {
        const value = fs.readFileSync(bitPath, "utf-8").trim();
        (caps as Record<string, string>)[bit] = value;
      }
    }
  } catch {
    // Ignore errors
  }
  return caps;
}

/**
 * Check if device is a touchpad based on capabilities
 */
export function isTouchpad(info: DeviceInfo): boolean {
  const name = info.name.toLowerCase();
  
  // Check name patterns
  if (name.includes("touchpad") || name.includes("trackpad")) {
    return true;
  }
  
  // Check capabilities - touchpads usually have absolute X/Y and KEY/TOUCH or BTN/TOUCH
  const caps = info.capabilities;
  if (caps.ev && caps.abs) {
    // Parse ev bitmask - bit 3 (0x08) is EV_ABS
    const evBits = parseInt(caps.ev, 16);
    const hasAbs = (evBits & 0x08) !== 0;
    
    if (hasAbs) {
      // Check if it has absolute X and Y
      const absBits = BigInt("0x" + caps.abs.replace(/ /g, ""));
      // ABS_X is bit 0, ABS_Y is bit 1
      const hasAbsX = (absBits & BigInt(1)) !== BigInt(0);
      const hasAbsY = (absBits & BigInt(2)) !== BigInt(0);
      
      // Check for touch capability (BTN_TOUCH = 0x14a)
      const hasTouch = caps.key ? 
        (BigInt("0x" + caps.key.replace(/ /g, "")) & (BigInt(1) << BigInt(0x14a))) !== BigInt(0) : false;
      
      // Check for finger tool
      const hasFinger = caps.key ?
        (BigInt("0x" + caps.key.replace(/ /g, "")) & (BigInt(1) << BigInt(0x145))) !== BigInt(0) : false;
      
      // Touchpads typically have absolute X/Y and touch/finger capability
      // but don't look like joysticks
      if (hasAbsX && hasAbsY && (hasTouch || hasFinger)) {
        // Exclude obvious joysticks/gamepads by name
        if (name.includes("joystick") || name.includes("gamepad") || 
            name.includes("controller") || name.includes("joy")) {
          return false;
        }
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if device is a gamepad/joystick
 */
export function isGamepad(info: DeviceInfo): boolean {
  const name = info.name.toLowerCase();
  
  // Check name patterns
  if (name.includes("gamepad") || name.includes("joystick") || 
      name.includes("controller") || name.includes("joy")) {
    return true;
  }
  
  // Check for BTN_JOYSTICK or BTN_GAMEPAD in key capabilities
  const caps = info.capabilities;
  if (caps.key) {
    const keyBits = BigInt("0x" + caps.key.replace(/ /g, ""));
    
    // BTN_JOYSTICK = 0x120, BTN_GAMEPAD = 0x130
    const hasJoystickBtn = (keyBits & (BigInt(1) << BigInt(0x120))) !== BigInt(0);
    const hasGamepadBtn = (keyBits & (BigInt(1) << BigInt(0x130))) !== BigInt(0);
    
    // Also check for common gamepad buttons
    // BTN_SOUTH/A = 0x130
    const hasABtn = (keyBits & (BigInt(1) << BigInt(0x130))) !== BigInt(0);
    
    if (hasJoystickBtn || hasGamepadBtn || hasABtn) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all input devices
 */
export function listInputDevices(): DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  const inputDir = "/sys/class/input";
  
  try {
    const entries = fs.readdirSync(inputDir);
    
    for (const entry of entries) {
      if (entry.startsWith("event")) {
        const devicePath = `/dev/input/${entry}`;
        const name = getDeviceName(devicePath);
        const caps = getDeviceCapabilities(devicePath);
        
        if (name) {
          devices.push({
            path: devicePath,
            name,
            phys: "",
            id: "",
            handlers: [],
            capabilities: caps,
          });
        }
      }
    }
  } catch (err) {
    console.error("Failed to list input devices:", err);
  }
  
  return devices;
}

/**
 * Find touchpad devices
 */
export function findTouchpads(): DeviceInfo[] {
  return listInputDevices().filter(isTouchpad);
}

/**
 * Find gamepad/joystick devices
 */
export function findGamepads(): DeviceInfo[] {
  return listInputDevices().filter(isGamepad);
}
