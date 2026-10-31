const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ProtectedClipboard, defaults, validate, OWNER } = require('../electron/protected-clipboard.cjs');
class Item {
  constructor(data) { this.data = data; this.types = Object.keys(data); }
  async getType(type) { const value = this.data[type]; return value instanceof Blob ? value : new Blob([value]); }
}
function fixture(platform = 'darwin') {
  const clipboard = { items: [], async write(items) { this.items = items; }, async read() { return this.items; }, async readText() { const item = this.items.find(item => item.types.includes('text/plain')); return item ? (await item.getType('text/plain')).text() : ''; }, clear() { this.items = []; } };
  return { clipboard, store: new ProtectedClipboard(clipboard, Item, { platform }) };
}
test('system clipboard round-trip is ordered, marked and clears only Harbor-owned data', async () => {
  const { clipboard, store } = fixture();
  const writing = store.copy('copied value', defaults());
  const reading = store.read();
  await writing; assert.equal(await reading, 'copied value');
  assert.ok(clipboard.items[0].types.includes(OWNER));
  assert.ok(clipboard.items[0].types.some(type => type.includes('ConcealedType')));
  await store.clear(); assert.equal(await clipboard.readText(), '');
  await store.copy('old value', defaults());
  await clipboard.write([new Item({ 'text/plain': 'another application' })]);
  await store.clear(); assert.equal(await clipboard.readText(), 'another application');
});
test('a stale expiry cannot erase a newer copy; Windows markers exclude history/cloud sync', async () => {
  const { clipboard, store } = fixture('win32');
  await store.copy('first', defaults()); const old = store.revision;
  await store.copy('second', defaults());
  await store.clear(old); assert.equal(await store.read(), 'second');
  const item = clipboard.items[0];
  assert.ok(item.types.some(type => type.includes('CanUploadToCloudClipboard')));
  const key = item.types.find(type => type.includes('CanIncludeInClipboardHistory'));
  assert.deepEqual([...new Uint8Array(await (await item.getType(key)).arrayBuffer())], [0,0,0,0]);
  await store.clear();
});
test('clipboard settings retain interoperability and reject malformed policies', () => {
  assert.equal(defaults().clipboardSeconds, 0);
  assert.deepEqual(validate(defaults()), defaults());
  for (const value of [null, {}, { secureKeyboard: true, clipboardSeconds: -1 }, { secureKeyboard: 'yes', clipboardSeconds: 60 }]) assert.throws(() => validate(value));
});
