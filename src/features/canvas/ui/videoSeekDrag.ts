/** No pointer capture: the video must never retain input outside the player. */
export function beginVideoSeekDrag(
  host: Window,
  pointerId: number,
  seek: (clientX: number) => void,
  onEnd: () => void,
): () => void {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerup', release);
    host.removeEventListener('pointercancel', release);
    host.removeEventListener('blur', end);
    onEnd();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // Recover even if the WebView lost the mouse-up outside its window.
    if (event.buttons === 0) { end(); return; }
    seek(event.clientX);
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId === pointerId) end();
  };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
  host.addEventListener('blur', end);
  return end;
}
