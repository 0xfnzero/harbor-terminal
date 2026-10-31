const crypto = require('node:crypto');
const OWNER = 'electron application/osclipboard;format="dev.harbor.clipboard-owner"';
const raw = name => `electron application/osclipboard;format="${name}"`;

class ProtectedClipboard {
  constructor(clipboard, ClipboardItem, { platform = process.platform, guard = () => {} } = {}) {
    this.clipboard = clipboard; this.ClipboardItem = ClipboardItem; this.platform = platform; this.guard = guard;
    this.queue = Promise.resolve(); this.owner = null; this.timer = null; this.revision = 0;
  }
  enqueue(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async clearOwned() {
    if (!this.owner) return;
    const owner = this.owner; this.owner = null;
    const items = await this.clipboard.read();
    for (const item of items) {
      if (item.types.includes(OWNER) && await (await item.getType(OWNER)).text() === owner) {
        this.clipboard.clear(); break;
      }
    }
  }
  copy(text, { clipboardSeconds }) {
    return this.enqueue(async () => {
      this.guard();
      clearTimeout(this.timer);
      const revision = ++this.revision;
      await this.clearOwned();
      this.guard();
      const owner = crypto.randomUUID();
      const payload = { 'text/plain': text, [OWNER]: owner };
      if (this.platform === 'darwin') {
        payload[raw('org.nspasteboard.ConcealedType')] = '1';
        payload[raw('org.nspasteboard.TransientType')] = '1';
      } else if (this.platform === 'win32') {
        payload[raw('CanIncludeInClipboardHistory')] = new Blob([new Uint8Array(4)]);
        payload[raw('CanUploadToCloudClipboard')] = new Blob([new Uint8Array(4)]);
        payload[raw('ExcludeClipboardContentFromMonitorProcessing')] = new Blob([new Uint8Array([1,0,0,0])]);
      }
      await this.clipboard.write([new this.ClipboardItem(payload)]);
      this.owner = owner;
      if (clipboardSeconds > 0) {
        this.timer = setTimeout(() => { this.clear(revision).catch(() => {}); }, clipboardSeconds * 1000);
        this.timer.unref?.();
      }
    });
  }
  read() {
    return this.enqueue(async () => { this.guard(); const text = await this.clipboard.readText(); this.guard(); return text; });
  }
  clear(expected) { return this.enqueue(async () => { if (expected !== undefined && expected !== this.revision) return; ++this.revision; clearTimeout(this.timer); this.timer = null; await this.clearOwned(); }); }
}
const defaults = () => ({ secureKeyboard: true, clipboardSeconds: 0 });
function validate(input) {
  if (!input || typeof input.secureKeyboard !== 'boolean' || ![0,30,60,120].includes(input.clipboardSeconds)) throw new Error('Invalid input privacy settings');
  return { secureKeyboard: input.secureKeyboard, clipboardSeconds: input.clipboardSeconds };
}
module.exports = { ProtectedClipboard, defaults, validate, OWNER };
