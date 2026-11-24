// Mouse-reporting applications own their highlights. Keep a separate local
// selection so Copy reads xterm's buffer, without changing remote configuration.
export function attachTerminalSelection(term, { enabled, onStart }) {
  const host = term.element;
  const screen = host.querySelector('.xterm-screen');
  const doc = host.ownerDocument;
  let drag = null;
  let forwarding = false;
  const point = event => {
    const box = screen.getBoundingClientRect();
    const column = Math.max(0, Math.min(term.cols, Math.floor((event.clientX - box.left) * term.cols / box.width)));
    const row = term.buffer.active.viewportY + Math.max(0, Math.min(term.rows - 1, Math.floor((event.clientY - box.top) * term.rows / box.height)));
    return row * term.cols + column;
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const down = event => {
    if (forwarding || !enabled() || !screen.contains(event.target) || term.modes.mouseTrackingMode === 'none') return;
    if (event.button === 2 && term.hasSelection()) { stop(event); return; }
    // Modified clicks retain xterm's built-in forced/rectangular selection and links.
    if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
    onStart();
    term.clearSelection();
    term.focus();
    drag = { start: point(event), x: event.clientX, y: event.clientY, event, buffer: term.buffer.active, moved: false };
    stop(event);
  };
  const move = event => {
    if (!drag || forwarding) return;
    if (!enabled() || drag.buffer !== term.buffer.active) { drag = null; return; }
    stop(event);
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true;
    const end = point(event), start = Math.min(drag.start, end);
    term.select(start % term.cols, Math.floor(start / term.cols), Math.abs(end - drag.start));
  };
  const up = event => {
    if (!drag || forwarding || event.button !== 0) return;
    move(event);
    const current = drag;
    drag = null;
    if (!current) return;
    stop(event);
    // Delay just the press/release pair until we know this was a click. Ordinary
    // application clicks still work; a drag never sends a stray press remotely.
    if (!current.moved && enabled() && current.event.target.isConnected) {
      forwarding = true;
      try {
        const options = { bubbles: true, cancelable: true, view: doc.defaultView, button: 0, detail: current.event.detail, clientX: current.x, clientY: current.y };
        current.event.target.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
        current.event.target.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
      } finally { forwarding = false; }
    }
  };
  const cancel = () => { drag = null; };
  host.addEventListener('mousedown', down, true);
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('mouseup', up, true);
  doc.defaultView.addEventListener('blur', cancel);
  return () => {
    cancel();
    host.removeEventListener('mousedown', down, true);
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('mouseup', up, true);
    doc.defaultView.removeEventListener('blur', cancel);
  };
}

// OSC 52 writes are offered to the user's Copy action, never applied to the OS
// clipboard automatically. Clipboard queries are consumed without any reply.
export function remoteSelection(data) {
  const separator = data.indexOf(';');
  if (separator < 0 || !/^[cpqs0-7]*$/.test(data.slice(0, separator))) return null;
  const encoded = data.slice(separator + 1);
  if (encoded === '?' || encoded.length > 1398104 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (bytes.length > 1048576) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}
