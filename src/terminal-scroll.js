// xterm 6's alternate-buffer fallback emits only one arrow per wheel event.
// Preserve wheel distance without interfering with application mouse protocols.
export function attachTerminalScroll(term) {
  let remainder = 0;
  let lastTime = 0;
  term.attachCustomWheelEventHandler(event => {
    if (term.buffer.active.type !== 'alternate' || term.modes.mouseTrackingMode !== 'none' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      remainder = 0;
      return true;
    }
    if (!Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return true;
    const cellHeight = (term.element?.querySelector('.xterm-screen')?.clientHeight || term.rows * 20) / term.rows;
    const distance = event.deltaY * (event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? term.rows : 1 / cellHeight);
    if (event.timeStamp - lastTime > 200 || Math.sign(distance) !== Math.sign(remainder)) remainder = 0;
    lastTime = event.timeStamp;
    remainder += distance;
    // Bound a single event to a screen; never queue a delayed scrolling tail.
    const lines = Math.min(term.rows, Math.floor(Math.abs(remainder)));
    remainder = Math.sign(remainder) * (Math.abs(remainder) % 1);
    if (lines) {
      const arrow = '\x1b' + (term.modes.applicationCursorKeysMode ? 'O' : '[') + (distance < 0 ? 'A' : 'B');
      term.input(arrow.repeat(lines), true);
    }
    event.preventDefault();
    return false;
  });
}
