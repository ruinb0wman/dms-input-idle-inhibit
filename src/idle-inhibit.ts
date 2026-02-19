/**
 * DMS Idle Inhibition via IPC
 *
 * Uses DMS (quickshell) IPC to control idle inhibition:
 *   dms ipc call inhibit enable  - Enable idle inhibit (prevent sleep)
 *   dms ipc call inhibit disable - Disable idle inhibit (allow sleep)
 */

import { spawn } from "child_process";

export interface IdleInhibitorConfig {
  /** Duration to keep idle inhibited after last input (ms) */
  duration: number;
  /** Whether to use toggle mode (if DMS doesn't support enable/disable) */
  useToggle?: boolean;
}

export interface IdleInhibitorState {
  readonly config: IdleInhibitorConfig;
  readonly active: boolean;
  readonly dmsAvailable: boolean | null;
}

/**
 * 创建初始的 idle inhibitor 状态
 */
export function createInhibitor(
  config: Partial<IdleInhibitorConfig> = {}
): IdleInhibitorState {
  return {
    config: {
      duration: config.duration ?? 5000,
      useToggle: config.useToggle ?? false,
    },
    active: false,
    dmsAvailable: null,
  };
}

/**
 * 检查 dms 命令是否可用
 */
async function checkDmsAvailable(
  state: IdleInhibitorState
): Promise<IdleInhibitorState> {
  if (state.dmsAvailable !== null) {
    return state;
  }

  const available = await new Promise<boolean>((resolve) => {
    const proc = spawn("which", ["dms"], { stdio: "ignore" });
    proc.on("exit", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });

  return {
    ...state,
    dmsAvailable: available,
  };
}

/**
 * 执行 DMS IPC 命令
 */
async function callDms(
  state: IdleInhibitorState,
  command: "enable" | "disable" | "toggle"
): Promise<void> {
  const stateWithCheck = await checkDmsAvailable(state);

  if (!stateWithCheck.dmsAvailable) {
    console.error("[idle-inhibit] Error: 'dms' command not found in PATH");
    console.error("[idle-inhibit] Please ensure DMS/quickshell is installed");
    return;
  }

  await new Promise<void>((resolve) => {
    const proc = spawn("dms", ["ipc", "call", "inhibit", command], {
      stdio: state.config.useToggle ? "inherit" : "ignore",
    });

    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[idle-inhibit] dms ipc call failed with code ${code}`);
      }
      resolve();
    });

    proc.on("error", (err) => {
      console.error(`[idle-inhibit] Failed to run dms: ${err.message}`);
      resolve();
    });
  });
}

/**
 * 启动 idle inhibition
 * 返回更新后的状态（active = true）
 * 注意：调用者需要在调用前检查 state.active 避免重复触发
 */
export async function inhibit(
  state: IdleInhibitorState
): Promise<IdleInhibitorState> {
  const newState: IdleInhibitorState = {
    ...state,
    active: true,
  };

  console.log("[idle-inhibit] Enabling DMS idle inhibition");
  await callDms(newState, "enable");

  return newState;
}

/**
 * 停止 idle inhibition
 * 返回更新后的状态（active = false）
 */
export async function release(
  state: IdleInhibitorState
): Promise<IdleInhibitorState> {
  if (!state.active) {
    return state;
  }

  const newState: IdleInhibitorState = {
    ...state,
    active: false,
  };

  console.log("[idle-inhibit] Disabling DMS idle inhibition");
  await callDms(newState, "disable");

  return newState;
}

/**
 * Toggle idle inhibition 状态（替代方法）
 */
export async function toggle(state: IdleInhibitorState): Promise<void> {
  await callDms(state, "toggle");
}

/**
 * 检查 inhibition 是否当前处于激活状态
 */
export function isInhibitorActive(state: IdleInhibitorState): boolean {
  return state.active;
}
