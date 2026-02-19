/**
 * DMS Idle Inhibition via IPC
 * 
 * Uses DMS (quickshell) IPC to control idle inhibition:
 *   dms ipc call inhibit enable  - Enable idle inhibit (prevent sleep)
 *   dms ipc call inhibit disable - Disable idle inhibit (allow sleep)
 */

import { spawn } from "child_process";

export interface IdleInhibitorOptions {
  /** Duration to keep idle inhibited after last input (ms) */
  duration: number;
  /** Whether to use toggle mode (if DMS doesn't support enable/disable) */
  useToggle?: boolean;
}

export class IdleInhibitor {
  private options: IdleInhibitorOptions;
  private timeoutId: Timer | null = null;
  private active = false;
  private dmsAvailable: boolean | null = null;

  constructor(options: Partial<IdleInhibitorOptions> = {}) {
    this.options = {
      duration: options.duration ?? 5000,
      useToggle: options.useToggle ?? false,
    };
  }

  /**
   * Check if dms command is available
   */
  private async checkDmsAvailable(): Promise<boolean> {
    if (this.dmsAvailable !== null) {
      return this.dmsAvailable;
    }

    return new Promise((resolve) => {
      const proc = spawn("which", ["dms"], { stdio: "ignore" });
      proc.on("exit", (code) => {
        this.dmsAvailable = code === 0;
        resolve(this.dmsAvailable);
      });
      proc.on("error", () => {
        this.dmsAvailable = false;
        resolve(false);
      });
    });
  }

  /**
   * Execute DMS IPC command
   */
  private async callDms(command: "enable" | "disable" | "toggle"): Promise<void> {
    const available = await this.checkDmsAvailable();
    if (!available) {
      console.error("[idle-inhibit] Error: 'dms' command not found in PATH");
      console.error("[idle-inhibit] Please ensure DMS/quickshell is installed");
      return;
    }

    return new Promise((resolve) => {
      const proc = spawn("dms", ["ipc", "call", "inhibit", command], {
        stdio: this.options.useToggle ? "inherit" : "ignore",
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
   * Start idle inhibition
   */
  async inhibit(): Promise<void> {
    // Reset the release timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // If already active, just extend the timeout
    if (this.active) {
      this.scheduleRelease();
      return;
    }

    this.active = true;
    console.log("[idle-inhibit] Enabling DMS idle inhibition");
    
    await this.callDms("enable");
    this.scheduleRelease();
  }

  /**
   * Stop idle inhibition
   */
  async release(): Promise<void> {
    if (!this.active) return;

    this.active = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    console.log("[idle-inhibit] Disabling DMS idle inhibition");
    await this.callDms("disable");
  }

  /**
   * Toggle idle inhibition state (alternative method)
   */
  async toggle(): Promise<void> {
    await this.callDms("toggle");
  }

  /**
   * Schedule the release of idle inhibition
   */
  private scheduleRelease(): void {
    this.timeoutId = setTimeout(() => {
      this.release();
    }, this.options.duration);
  }

  /**
   * Check if inhibition is currently active
   */
  isActive(): boolean {
    return this.active;
  }
}
