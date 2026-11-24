const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/terminal-selection.js'), 'utf8');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('remote copy accepts Unicode text and empty selections but never clipboard queries or malformed payloads', async () => {
  const { remoteSelection } = await load();
  const text = 'Claude / tmux / Vim 中文\nemoji: 🦀\r\n';
  for (const selection of ['', 'c', 'p', 'cp', 's', '0']) assert.equal(remoteSelection(selection + ';' + Buffer.from(text).toString('base64')), text);
  assert.equal(remoteSelection('c;'), '');
  for (const data of ['c;?', 'p;?', '?', 'c', 'invalid;' + Buffer.from('text').toString('base64'), 'c;not base64!', 'c;/w==', 'c;A', 'c;YWJj;extra']) assert.equal(remoteSelection(data), null, data);
});
test('remote selections obey the clipboard byte limit before UTF-8 decoding', async () => {
  const { remoteSelection } = await load();
  const text = 'x'.repeat(1048576);
  assert.equal(remoteSelection('c;' + Buffer.from(text).toString('base64')), text);
  assert.equal(remoteSelection('c;' + Buffer.from(text + 'x').toString('base64')), null);
  assert.equal(remoteSelection('c;' + Buffer.from('中'.repeat(349526)).toString('base64')), null);
});
