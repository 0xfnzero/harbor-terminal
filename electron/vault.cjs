const { t: tr } = require('./locale.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { validateServer } = require('./core.cjs');
const scrypt = promisify(crypto.scrypt);
const KIND = 'harbor-vault';
const KDF = { name: 'scrypt', N: 131072, r: 8, p: 1 };
function seal(key, value, context) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const plain = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  try {
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  } finally { plain.fill(0); }
}
function open(key, box, context) {
  if (!box || typeof box.iv !== 'string' || typeof box.tag !== 'string' || typeof box.data !== 'string') throw new Error(tr("加密数据格式不正确"));
  const iv = Buffer.from(box.iv, 'base64'), tag = Buffer.from(box.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error(tr("加密数据格式不正确"));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  // Do not release unauthenticated plaintext, even when final() rejects.
  const first = cipher.update(Buffer.from(box.data, 'base64'));
  try { return Buffer.concat([first, cipher.final()]); } finally { first.fill(0); }
}
function decode(key, box, context) {
  const plain = open(key, box, context);
  try { return JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
}
function passwordValue(value, creating = false) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 || (creating && value.length < 12)) throw new Error(tr("应用锁屏密码至少 12 个字符，最长 1024 字节"));
  return value;
}
async function derive(password, salt) {
  const bytes = Buffer.from(passwordValue(password));
  try { return await scrypt(bytes, Buffer.from(salt, 'base64'), 32, { ...KDF, maxmem: 256 * 1024 * 1024 }); }
  finally { bytes.fill(0); }
}
function dataContext(doc) { return `${KIND}:1:${doc.id}:data:idle=${doc.settings.idleMinutes}`; }
function preferences(input) {
  const idleMinutes = Number(input.idleMinutes ?? 30);
  if (![5, 15, 30, 60, 120, 0].includes(idleMinutes)) throw new Error(tr("自动锁定时间不正确"));
  return { idleMinutes };
}
// One atomic document replaces the legacy JSON; no plaintext migration backup.
async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, file);
  } finally { await handle?.close(); await fs.rm(temp, { force: true }); }
}
// Configuration generations and per-session keys never go on disk. A running
// connection owns an independent encrypted snapshot until its tab is closed.
const memoryContext = (generation, purpose) => `harbor-memory:1:${generation}:${purpose}`;
class Vault {
  constructor(file, { safeStorage, systemPreferences, platform = process.platform, now = Date.now } = {}) {
    this.file = file; this.safeStorage = safeStorage; this.systemPreferences = systemPreferences;
    this.platform = platform; this.now = now; this.doc = null; this.memoryKey = null;
    this.box = null; this.diskKeyBox = null; this.generation = null;
    this.sessionBoxes = new Map();
    this.queue = Promise.resolve(); this.epoch = 0; this.failures = 0; this.retryAt = 0;
  }
  serial(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async load() {
    let value = [];
    try { value = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (Array.isArray(value)) {
      this.installMemory(this.prepareMemory(null, value.map(validateServer)));
    } else {
      if (value?.kind !== KIND || value.version !== 1 || typeof value.id !== 'string' || !value.passwordWrap || !value.data || value.kdf?.name !== KDF.name || value.kdf.N !== KDF.N || value.kdf.r !== KDF.r || value.kdf.p !== KDF.p || Buffer.from(value.salt || '', 'base64').length !== 16) throw new Error(tr("不支持或损坏的安全配置；原文件已保留"));
      preferences(value.settings); this.doc = value;
    }
  }
  // Capability rendering must not access Keychain: Electron may display a system
  // prompt even from isEncryptionAvailable(). Probe storage only on explicit Touch ID actions.
  touchAvailable() {
    try { return this.platform === 'darwin' && typeof this.safeStorage?.encryptString === 'function' && this.systemPreferences?.canPromptTouchID() === true; } catch { return false; }
  }
  state() { return { enabled: !!this.doc, locked: !!this.doc && !this.memoryKey, touchAvailable: this.touchAvailable(), touchEnabled: !!this.doc?.touchWrap, idleMinutes: this.doc?.settings.idleMinutes ?? 30 }; }
  assertUnlocked() { if (!this.memoryKey) throw new Error(tr("请先解锁 Harbor")); }
  keyContext() { return `${KIND}:1:${this.doc.id}:key`; }
  // Configuration reads never use the disk key. Authentication generates a
  // fresh memory key; live-session caches have their own independent lifetime.
  prepareMemory(diskKey, values) {
    const memoryKey = crypto.randomBytes(32), generation = crypto.randomUUID();
    try {
      return {
        memoryKey, generation,
        box: seal(memoryKey, values, memoryContext(generation, 'data')),
        diskKeyBox: diskKey ? seal(memoryKey, diskKey, memoryContext(generation, 'disk-key')) : null,
      };
    } catch (e) { memoryKey.fill(0); throw e; }
  }
  installMemory(next) { this.memoryKey?.fill(0); Object.assign(this, next); }
  read() { this.assertUnlocked(); return decode(this.memoryKey, this.box, memoryContext(this.generation, 'data')); }
  sealSession(value) {
    this.assertUnlocked(); const id = crypto.randomUUID(), key = crypto.randomBytes(32);
    try { this.sessionBoxes.set(id, { key, box: seal(key, value, `harbor-session:1:${id}`) }); }
    catch (e) { key.fill(0); throw e; }
    return id;
  }
  readSession(id) { this.assertUnlocked(); return this.readSessionForReconnect(id); }
  // Main-process transport only. NEVER expose this method over renderer IPC.
  // Locking blocks UI reads/new connections, but an existing tab may recover
  // the same target without requiring the configuration vault to be unlocked.
  readSessionForReconnect(id) {
    const entry = this.sessionBoxes.get(id);
    if (!entry) throw new Error(tr("连接会话已关闭"));
    return decode(entry.key, entry.box, `harbor-session:1:${id}`);
  }
  releaseSession(id) { this.sessionBoxes.get(id)?.key.fill(0); this.sessionBoxes.delete(id); }
  summaries() { return this.read().map(({ identityFile, certificateFile, ...summary }) => summary); }
  get(id) { return this.read().find(s => s.id === id); }
  mutate(fn) { return this.serial(async () => {
    const epoch = this.epoch;
    let values = fn(this.read()).map(validateServer);
    const box = seal(this.memoryKey, values, memoryContext(this.generation, 'data'));
    if (this.doc) {
      const diskKey = open(this.memoryKey, this.diskKeyBox, memoryContext(this.generation, 'disk-key'));
      let doc;
      try { doc = { ...this.doc, data: seal(diskKey, values, dataContext(this.doc)) }; }
      finally { diskKey.fill(0); values = null; }
      await atomicWrite(this.file, doc); this.doc = doc;
    } else { await atomicWrite(this.file, values); values = null; }
    if (epoch !== this.epoch) throw new Error(tr("应用已锁定；请解锁后查看保存结果"));
    this.box = box;
    return this.summaries();
  }); }
  async makeTouch(key, id) {
    if (!this.touchAvailable() || !this.safeStorage.isEncryptionAvailable()) throw new Error(tr("当前设备无法使用 Touch ID，请使用应用锁屏密码"));
    await this.systemPreferences.promptTouchID(tr("启用 Harbor 指纹解锁"));
    return this.safeStorage.encryptString(JSON.stringify({ id, key: key.toString('base64') })).toString('base64');
  }
  enable(password, settings = {}) { return this.serial(async () => {
    if (this.doc) throw new Error(tr("安全锁已启用"));
    passwordValue(password, true);
    const epoch = this.epoch, id = crypto.randomUUID(), salt = crypto.randomBytes(16).toString('base64');
    const wrapping = await derive(password, salt), diskKey = crypto.randomBytes(32);
    let staged;
    try {
      const doc = { kind: KIND, version: 1, id, kdf: KDF, salt, settings: preferences(settings), passwordWrap: seal(wrapping, diskKey, `${KIND}:1:${id}:key`), touchWrap: settings.touchEnabled ? await this.makeTouch(diskKey, id) : null };
      let values = this.read();
      doc.data = seal(diskKey, values, dataContext(doc));
      staged = this.prepareMemory(diskKey, values); values = null;
      diskKey.fill(0); wrapping.fill(0);
      await atomicWrite(this.file, doc);
      this.doc = doc; this.installMemory(staged); staged = null;
      if (epoch !== this.epoch) this.lock();
      return this.state();
    } finally { diskKey.fill(0); wrapping.fill(0); staged?.memoryKey.fill(0); }
  }); }
  lock() {
    ++this.epoch;
    if (this.doc) {
      this.memoryKey?.fill(0); this.memoryKey = null;
      this.box = null; this.diskKeyBox = null;
      // Per-tab keys remain available only to the background transport.
      // They cannot unlock the configuration vault or modify existing targets.
    }
    return this.state();
  }
  unlock(method, password) { return this.serial(async () => {
    if (!this.doc || this.memoryKey) return this.state();
    if (this.now() < this.retryAt) throw new Error(tr("尝试过于频繁，请稍后再试"));
    const epoch = this.epoch;
    let diskKey, staged;
    try {
      if (method === 'touch') {
        if (!this.doc.touchWrap || !this.touchAvailable() || !this.safeStorage.isEncryptionAvailable()) throw new Error(tr("Touch ID 不可用"));
        await this.systemPreferences.promptTouchID(tr("解锁 Harbor 服务器与终端"));
        const wrapped = JSON.parse(this.safeStorage.decryptString(Buffer.from(this.doc.touchWrap, 'base64')));
        if (wrapped.id !== this.doc.id) throw new Error(tr("无效的指纹密钥"));
        diskKey = Buffer.from(wrapped.key, 'base64');
      } else if (method === 'password') {
        const wrapping = await derive(password, this.doc.salt);
        try { diskKey = open(wrapping, this.doc.passwordWrap, this.keyContext()); } finally { wrapping.fill(0); }
      } else throw new Error(tr("无效的解锁方式"));
      if (diskKey.length !== 32) throw new Error(tr("无效密钥"));
      let values = decode(diskKey, this.doc.data, dataContext(this.doc)).map(validateServer);
      if (epoch !== this.epoch) throw new Error(tr("解锁已取消"));
      staged = this.prepareMemory(diskKey, values); values = null;
      this.installMemory(staged); staged = null;
      this.failures = 0; this.retryAt = 0;
      return this.state();
    } catch {
      this.retryAt = this.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5));
      throw new Error(method === 'touch' ? tr("指纹解锁未完成，请重试或使用应用锁屏密码") : tr("解锁失败：密码不正确或加密文件已损坏"));
    } finally { diskKey?.fill(0); staged?.memoryKey.fill(0); }
  }); }
  configure(password, settings, newPassword) { return this.serial(async () => {
    this.assertUnlocked(); if (!this.doc) throw new Error(tr("请先启用安全锁"));
    const epoch = this.epoch;
    const wrapping = await derive(password, this.doc.salt);
    let diskKey;
    try { diskKey = open(wrapping, this.doc.passwordWrap, this.keyContext()); }
    catch { throw new Error(tr("当前应用锁屏密码不正确")); }
    finally { wrapping.fill(0); }
    try {
      this.assertUnlocked();
      const next = { ...this.doc, settings: preferences(settings) };
      if (newPassword) {
        passwordValue(newPassword, true); next.salt = crypto.randomBytes(16).toString('base64');
        const replacement = await derive(newPassword, next.salt);
        try { next.passwordWrap = seal(replacement, diskKey, this.keyContext()); } finally { replacement.fill(0); }
      }
      if (settings.touchEnabled && !next.touchWrap) next.touchWrap = await this.makeTouch(diskKey, next.id);
      if (!settings.touchEnabled) next.touchWrap = null;
      if (epoch !== this.epoch) throw new Error(tr("应用已锁定，请重新解锁"));
      next.data = seal(diskKey, this.read(), dataContext(next));
      diskKey.fill(0);
      await atomicWrite(this.file, next); this.doc = next;
      return this.state();
    } finally { diskKey.fill(0); }
  }); }
  dispose() {
    this.memoryKey?.fill(0); this.memoryKey = null;
    this.box = this.diskKeyBox = null;
    for (const id of this.sessionBoxes.keys()) this.releaseSession(id);
  }
}
module.exports = { Vault, seal, open, atomicWrite };
