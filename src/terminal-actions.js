// Leave Ctrl+C/Ctrl+V and other unmodified terminal controls to the shell.
export function terminalShortcut(event, mac) {
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (event.shiftKey && event.key === 'Insert' && !event.ctrlKey && !event.metaKey) return 'paste';
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey;
  if (!modifier) return null;
  return ({ c: 'copy', v: 'paste', a: 'selectAll', f: 'search', k: 'clear', end: 'bottom' })[key] || null;
}
