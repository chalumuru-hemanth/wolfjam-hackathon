/** Client intent only. Deliberately independent of Phaser and any server protocol. */
export interface InputFrame {
  moveX: number;
  moveY: number;
  actionHeld: boolean;
  actionPressed: boolean;
}

const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
export const GAME_CODES = new Set([...MOVE_CODES, 'Space']);

export class InputState {
  private enabled = false;
  private readonly keys = new Set<string>();
  private joystickX = 0;
  private joystickY = 0;
  private touchAction = false;
  private pendingAction = false;

  get active(): boolean { return this.enabled; }
  get actionHeld(): boolean { return this.enabled && (this.touchAction || this.keys.has('Space')); }

  setEnabled(enabled: boolean): void {
    this.reset();
    this.enabled = enabled;
  }

  setKey(code: string, down: boolean): void {
    if (!this.enabled || !GAME_CODES.has(code)) return;
    const heldBefore = this.actionHeld;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (!heldBefore && this.actionHeld) this.pendingAction = true;
  }

  setTouchAction(down: boolean): void {
    if (!this.enabled) return;
    const heldBefore = this.actionHeld;
    this.touchAction = down;
    if (!heldBefore && this.actionHeld) this.pendingAction = true;
  }

  /** Input is joystick displacement divided by its radius. */
  setJoystick(x: number, y: number): void {
    if (!this.enabled) return;
    const distance = Math.hypot(x, y);
    if (!Number.isFinite(distance) || distance <= 0.15) {
      this.joystickX = 0;
      this.joystickY = 0;
      return;
    }
    const magnitude = (Math.min(distance, 1) - 0.15) / 0.85;
    this.joystickX = (x / distance) * magnitude;
    this.joystickY = (y / distance) * magnitude;
  }

  /** Consume actionPressed exactly once, including taps between rendered frames. */
  sample(): InputFrame {
    if (!this.enabled) return { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false };
    let moveX = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    let moveY = Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW'));
    const length = Math.hypot(moveX, moveY);
    if (length > 0) {
      moveX /= length;
      moveY /= length;
    } else {
      moveX = this.joystickX;
      moveY = this.joystickY;
    }
    const frame = { moveX, moveY, actionHeld: this.actionHeld, actionPressed: this.pendingAction };
    this.pendingAction = false;
    return frame;
  }

  reset(): void {
    this.keys.clear();
    this.joystickX = 0;
    this.joystickY = 0;
    this.touchAction = false;
    this.pendingAction = false;
  }
}
