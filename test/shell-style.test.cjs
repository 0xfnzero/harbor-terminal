const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const pty = require('node-pty');
const { styledShell } = require('../electron/shell-style.cjs');

test('styled zsh preserves user startup files, enables colors and bundled highlighting', { skip: !fs.existsSync('/bin/zsh'), timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor style '));
  const user = path.join(dir, 'user config'); fs.mkdirSync(user);
  const original = 'export HARBOR_STARTUP_FIXTURE=loaded\n';
  fs.writeFileSync(path.join(user, '.zshrc'), original);
  fs.mkdirSync(path.join(dir, 'directory'));
  let child;
  try {
    const env = { ...process.env, HOME: dir, ZDOTDIR: user };
    const command = styledShell({ executable: '/bin/zsh', args: ['-l'] }, path.join(dir, 'style'), process.platform, env);
    child = pty.spawn(command.executable, command.args, { cwd: dir, cols: 120, rows: 30, env: { ...env, ...command.env, TERM: 'xterm-256color' } });
    let output = ''; child.onData(data => { output += data; });
    const until = async fn => { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw new Error('Shell fixture timed out'); await new Promise(r => setTimeout(r, 30)); } };
    await until(() => output.includes('❯'));
    child.write("printf '__STYLE_%s|%s|%s__\\n' \"$HARBOR_STARTUP_FIXTURE\" \"$CLICOLOR\" \"$+functions[_zsh_highlight]\"\r");
    await until(() => output.includes('__STYLE_loaded|1|1__'));
    output = ''; child.write('ls\r'); await until(() => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').includes('directory'));
    assert.match(output, /\x1b\[[\d;]*m/);
    output = '';
    child.write('\x1b[200~echo PASTE_STYLE_CHECK\x1b[201~');
    await until(() => output.includes('PASTE_STYLE_CHECK'));
    assert.doesNotMatch(output, /\x1b\[(?:[0-9;]*;)?7m/, 'pasted text should not use inverse selection styling');
    child.write('\x15');
    child.write("printf '__PATH_%s__\\n' READY\r");
    await until(() => output.includes('__PATH_READY__'));
    output = ''; child.write('cd directory');
    await until(() => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').includes('directory'));
    assert.doesNotMatch(output, /\x1b\[(?:[0-9;]*;)?4m/, 'existing paths should not be underlined');
    assert.match(output, /\x1b\[36m/, 'existing paths use cyan');
    child.write('\x15');
    assert.equal(fs.readFileSync(path.join(user, '.zshrc'), 'utf8'), original);
    child.write("printf '__RESTORED_%s__\\n' \"$ZDOTDIR\"\r");
    await until(() => output.includes(`__RESTORED_${user}__`));
  } finally { if (child) await new Promise(resolve => { child.onExit(resolve); child.kill(); }); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
});
