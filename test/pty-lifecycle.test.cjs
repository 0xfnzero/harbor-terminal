const { test } = require('node:test');
const assert = require('node:assert/strict');
const pty = require('node-pty');
const { resizeSession } = require('../electron/pty-lifecycle.cjs');

test('resize tolerates a closed real PTY while retaining dimensions and exit ownership', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const child = pty.spawn('/bin/sh', ['-c', 'exit 0'], { cols: 80, rows: 24, env: { ...process.env, TERM: 'xterm' } });
  await new Promise(resolve => child.onExit(resolve));
  const session = { pty: child };
  // Models the interval in which the OS descriptor is gone but the application
  // has not processed its exit callback yet, without manipulating internal FDs.
  resizeSession(session, 120, 40);
  assert.equal(session.pty, child);
  assert.equal(session.cols, 120);
  assert.equal(session.rows, 40);
  session.pty = null;
  resizeSession(session, 100, 30);
  const calls = [];
  session.pty = { resize: (...size) => calls.push(size) };
  resizeSession(session, session.cols, session.rows);
  assert.deepEqual(calls, [[100, 30]]);
});

test('recognizes Unix and Windows exit races without suppressing unrelated resize errors', () => {
  for (const error of [new Error('ioctl(2) failed, EBADF'), new Error('ioctl(2) failed, ENOTTY'), Object.assign(new Error('closed descriptor'), { code: 'EIO' }), new Error('Cannot resize a pty that has already exited')]) {
    assert.doesNotThrow(() => resizeSession({ pty: { resize: () => { throw error; } } }, 80, 24));
  }
  const unexpected = new Error('unexpected resize failure');
  assert.throws(() => resizeSession({ pty: { resize: () => { throw unexpected; } } }, 80, 24), error => error === unexpected);
});
