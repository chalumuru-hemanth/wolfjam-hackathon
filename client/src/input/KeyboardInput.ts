import { GAME_CODES, InputState } from './InputState';

export class KeyboardInput {
  constructor(private readonly state: InputState) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  private readonly onDown = (event: KeyboardEvent): void => {
    const target = event.target;
    const editing = target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName));
    if (!this.state.active || !GAME_CODES.has(event.code) || editing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    this.state.setKey(event.code, true);
  };

  private readonly onUp = (event: KeyboardEvent): void => {
    this.state.setKey(event.code, false);
    if (this.state.active && GAME_CODES.has(event.code)) event.preventDefault();
  };

  destroy(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    this.state.reset();
  }
}
