export interface Layout {
  width: number;
  height: number;
  arenaTop: number;
  arenaHeight: number;
  controlsTop: number;
  joystickX: number;
  actionX: number;
  controlY: number;
}

export function readLayout(width: number, height: number): Layout {
  const probe = document.querySelector<HTMLElement>('#safe-area-probe');
  const style = probe ? getComputedStyle(probe) : undefined;
  const safe = (side: 'Top' | 'Right' | 'Bottom' | 'Left'): number => Number.parseFloat(style?.[`padding${side}`] ?? '0') || 0;
  const arenaTop = 58 + safe('Top');
  const controlsTop = height - 154 - safe('Bottom');
  return {
    width, height, arenaTop,
    arenaHeight: Math.max(80, controlsTop - arenaTop),
    controlsTop,
    joystickX: 28 + safe('Left') + 56,
    actionX: width - 28 - safe('Right') - 56,
    controlY: height - safe('Bottom') - 82,
  };
}
