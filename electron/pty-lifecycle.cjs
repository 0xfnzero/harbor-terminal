// node-pty can close the OS descriptor before delivering onExit. Keep the
// session reference intact so that onExit still owns status/reconnect handling.
function resizeSession(session, cols, rows) {
  session.cols = cols;
  session.rows = rows;
  if (!session.pty) return;
  try {
    session.pty.resize(cols, rows);
  } catch (error) {
    const code = error?.code;
    const message = error?.message || '';
    if (['EBADF', 'EIO', 'ESRCH', 'ENOTTY'].includes(code) || /\b(?:EBADF|EIO|ESRCH|ENOTTY)\b/.test(message) || message === 'Cannot resize a pty that has already exited') return;
    throw error;
  }
}
module.exports = { resizeSession };
