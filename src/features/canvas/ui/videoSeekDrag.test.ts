import { describe, expect, it, vi } from 'vitest';
import { beginVideoSeekDrag } from './videoSeekDrag';

function pointer(type: string, pointerId = 1, buttons = 1, clientX = 42) {
  return Object.assign(new Event(type), { pointerId, buttons, clientX });
}

describe('video seek gesture lifecycle', () => {
  it.each(['pointerup', 'pointercancel', 'blur', 'lost-mouseup', 'unmount'])('%s releases the gesture and removes listeners', (termination) => {
    const host = new EventTarget() as unknown as Window;
    const seek = vi.fn();
    const end = vi.fn();
    const cleanup = beginVideoSeekDrag(host, 1, seek, end);
    host.dispatchEvent(pointer('pointermove'));
    expect(seek).toHaveBeenCalledWith(42);
    if (termination === 'unmount') cleanup();
    else if (termination === 'lost-mouseup') host.dispatchEvent(pointer('pointermove', 1, 0));
    else if (termination === 'blur') host.dispatchEvent(new Event('blur'));
    else host.dispatchEvent(pointer(termination, 1, 0));
    host.dispatchEvent(pointer('pointermove', 1, 1, 999));
    cleanup();
    expect(seek).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ignores other fingers without terminating the active gesture', () => {
    const host = new EventTarget() as unknown as Window;
    const seek = vi.fn();
    const end = vi.fn();
    const cleanup = beginVideoSeekDrag(host, 1, seek, end);
    host.dispatchEvent(pointer('pointermove', 2));
    host.dispatchEvent(pointer('pointerup', 2, 0));
    expect(seek).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    host.dispatchEvent(pointer('pointermove'));
    expect(seek).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
