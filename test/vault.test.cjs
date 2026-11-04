require('../electron/locale.cjs').setLanguage('zh-CN');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../electron/vault.cjs');
const secret = 'fixture-strong-lock-password';
const server = { name: 'private-account-marker', host: 'private.example.com', username: 'privateuser', identityFile: '/secret/path/key.pem' };
async function fixture(t, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-vault-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'servers.json');
  await fs.writeFile(file, JSON.stringify([server]), { mode: 0o600 });
  const vault = new Vault(file, options); await vault.load(); t.after(() => vault.dispose());
  return { vault, file, dir };
}
test('vault migrates without plaintext backup, persists ciphertext and requires unlock after restart', async t => {
  const { vault, file, dir } = await fixture(t);
  assert.equal(vault.summaries()[0].identityFile, undefined);
  await vault.enable(secret, { idleMinutes: 30 });
  const oldKey = vault.memoryKey;
  const snapshot = vault.sealSession(vault.read()[0]);
  assert.equal(JSON.stringify(snapshot).includes(server.host), false);
  for (const filename of await fs.readdir(dir)) {
    const contents = await fs.readFile(path.join(dir, filename), 'utf8');
    for (const value of [...Object.values(server), secret]) assert.equal(contents.includes(value), false);
  }
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  vault.lock(); assert.ok(oldKey.every(v => v === 0));
  assert.throws(() => vault.read(), /解锁/); assert.throws(() => vault.readSession(snapshot), /解锁/);
  await assert.rejects(vault.mutate(() => []), /解锁/);
  const loaded = new Vault(file); await loaded.load(); t.after(() => loaded.dispose());
  assert.equal(loaded.state().locked, true);
  await loaded.unlock('password', secret);
  assert.equal(loaded.read()[0].host, server.host);
  await loaded.mutate(list => [...list, { name: 'second', host: 'second.example.com' }]);
  const doc = JSON.parse(await fs.readFile(file)); assert.equal(doc.kind, 'harbor-vault');
  await vault.unlock('password', secret);
  assert.equal(vault.readSession(snapshot).host, server.host);
});
test('wrong password is rejected and throttled; ciphertext, policy and wrapped-key tampering fail closed', async t => {
  const { vault, file } = await fixture(t);
  await vault.enable(secret); vault.lock();
  await assert.rejects(vault.unlock('password', 'wrong'), /解锁失败/);
  await assert.rejects(vault.unlock('password', secret), /频繁/);
  const original = JSON.parse(await fs.readFile(file));
  for (const field of ['data', 'passwordWrap', 'settings']) {
    const doc = structuredClone(original);
    if (field === 'settings') doc.settings.idleMinutes = 0;
    else { const bytes = Buffer.from(doc[field].data, 'base64'); bytes[0] ^= 1; doc[field].data = bytes.toString('base64'); }
    await fs.writeFile(file, JSON.stringify(doc));
    const v = new Vault(file); await v.load();
    await assert.rejects(v.unlock('password', secret), /解锁失败/);
    assert.equal(v.state().locked, true);
  }
});
test('password change preserves data, reseals policy, and invalidates old password on restart', async t => {
  const { vault, file } = await fixture(t);
  await vault.enable(secret);
  await assert.rejects(vault.configure('wrong', { idleMinutes: 0 }, 'new-strong-password'), /当前/);
  await vault.configure(secret, { idleMinutes: 60 }, 'new-strong-password');
  vault.lock(); await vault.unlock('password', 'new-strong-password');
  assert.equal(vault.read()[0].host, server.host); assert.equal(vault.state().idleMinutes, 60);
  const loaded = new Vault(file); await loaded.load();
  await assert.rejects(loaded.unlock('password', secret), /解锁失败/);
});
test('Touch ID gates OS wrapper access; cancellation and unavailable biometrics keep vault locked', async t => {
  let allow = true, prompts = 0, decrypts = 0;
  // Stub verifies control flow; it does not stand in for a physical biometric acceptance test.
  const options = { platform: 'darwin', now: () => Date.now() + prompts * 60000, safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => { decrypts++; return b.toString(); } }, systemPreferences: { canPromptTouchID: () => true, promptTouchID: async () => { prompts++; if (!allow) throw new Error('cancel'); } } };
  const { vault } = await fixture(t, options);
  await vault.enable(secret, { touchEnabled: true }); assert.equal(prompts, 1);
  vault.lock(); allow = false;
  await assert.rejects(vault.unlock('touch'), /指纹解锁未完成/); assert.equal(decrypts, 0);
  allow = true; vault.retryAt = 0; await vault.unlock('touch'); assert.equal(decrypts, 1);
  await vault.unlock('touch'); assert.equal(decrypts, 1, 'unlocked session reuses key');
  await vault.configure(secret, { touchEnabled: false, idleMinutes: 30 }); vault.lock();
  await assert.rejects(vault.unlock('touch'), /指纹解锁未完成/);
  const { vault: linux } = await fixture(t, { ...options, platform: 'linux' });
  await assert.rejects(linux.enable(secret, { touchEnabled: true }), /无法使用 Touch ID/);
  assert.equal(linux.state().enabled, false);
});
test('lock during asynchronous password derivation cancels unlock and destroys transient keys', async t => {
  const { vault } = await fixture(t);
  await vault.enable(secret); vault.lock();
  const attempt = vault.unlock('password', secret);
  await new Promise(resolve => setTimeout(resolve, 10)); vault.lock();
  await assert.rejects(attempt, /解锁失败/); assert.equal(vault.memoryKey, null);
});

test('each unlock gets an independent memory key; reads use only memory ciphertext and preserve original session snapshots', async t => {
  const { vault, file } = await fixture(t);
  const original = vault.read()[0];
  const session = vault.sealSession(original); // A connection already exists BEFORE enabling security.
  const initialMemoryKey = vault.memoryKey;
  await vault.enable(secret);
  assert.ok(initialMemoryKey.every(b => b === 0));
  assert.equal(vault.readSession(session).host, original.host);
  const { open } = require('../electron/vault.cjs');
  const crypto = require('node:crypto');
  const doc = JSON.parse(await fs.readFile(file));
  const wrapping = crypto.scryptSync(secret, Buffer.from(doc.salt, 'base64'), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const diskKey = open(wrapping, doc.passwordWrap, `harbor-vault:1:${doc.id}:key`); wrapping.fill(0);
  try {
    assert.notDeepEqual(vault.memoryKey, diskKey);
    assert.throws(() => open(vault.memoryKey, doc.data, `harbor-vault:1:${doc.id}:data:idle=30`));
    assert.throws(() => open(diskKey, vault.box, `harbor-memory:1:${vault.generation}:data`));
    // A corrupt disk-data copy cannot affect normal read/connect operations after unlock.
    const diskData = vault.doc.data; vault.doc.data = null;
    assert.equal(vault.get(original.id).host, original.host);
    assert.equal(vault.readSession(session).identityFile, original.identityFile);
    vault.doc.data = diskData;
    await vault.mutate(list => list.map(s => ({ ...s, host: 'edited.example.com', identityFile: '/changed/key.pem' })));
    const editedSession = vault.sealSession(vault.get(original.id));
    await vault.mutate(() => []); // Removing the saved entry must not destroy open-tab settings.
    for (let cycle = 0; cycle < 3; cycle++) {
      const oldKey = vault.memoryKey, copy = Buffer.from(oldKey), oldGeneration = vault.generation;
      const runtime = vault.sessionBoxes.get(session);
      const runtimeKey = Buffer.from(runtime.key);
      vault.lock();
      assert.ok(oldKey.every(b => b === 0));
      assert.equal(vault.diskKeyBox, null); assert.equal(vault.box, null);
      assert.throws(() => vault.readSession(session), /解锁/);
      assert.equal(vault.readSessionForReconnect(session).host, original.host);
      await vault.unlock('password', secret);
      assert.notDeepEqual(vault.memoryKey, copy); assert.notDeepEqual(vault.memoryKey, diskKey);
      copy.fill(0);
      assert.notEqual(vault.generation, oldGeneration);
      assert.equal(vault.sessionBoxes.get(session), runtime, 'configuration unlock never rotates a live connection key');
      assert.deepEqual(runtime.key, runtimeKey); runtimeKey.fill(0);
      assert.throws(() => open(vault.memoryKey, runtime.box, `harbor-session:1:${session}`));
      assert.equal(vault.readSession(session).host, original.host);
      assert.equal(vault.readSession(editedSession).host, 'edited.example.com');
      assert.deepEqual(vault.read(), []);
    }
    const disk = await fs.readFile(file, 'utf8');
    assert.equal(disk.includes(vault.generation), false);
    assert.equal(disk.includes(session), false, 'live session snapshots never go on disk');
    const retiredKey = vault.sessionBoxes.get(session).key;
    vault.releaseSession(session); assert.ok(retiredKey.every(b => b === 0));
    assert.throws(() => vault.readSession(session));
    assert.throws(() => vault.readSessionForReconnect(session));
    assert.equal(vault.readSession(editedSession).host, 'edited.example.com');
  } finally { diskKey.fill(0); }
});

test('failed unlock leaves existing runtime snapshots usable but cannot expose vault configuration', async t => {
  const { vault } = await fixture(t);
  await vault.enable(secret);
  const session = vault.sealSession(vault.read()[0]), runtime = vault.sessionBoxes.get(session);
  const originalData = vault.doc.data;
  vault.lock();
  vault.doc.data = { ...originalData, tag: Buffer.alloc(16).toString('base64') };
  await assert.rejects(vault.unlock('password', secret), /解锁失败/);
  assert.equal(vault.memoryKey, null);
  assert.throws(() => vault.readSession(session), /解锁/);
  assert.equal(vault.readSessionForReconnect(session).host, server.host);
  assert.equal(vault.sessionBoxes.get(session), runtime);
  vault.doc.data = originalData; vault.retryAt = 0;
  await vault.unlock('password', secret);
  assert.equal(vault.sessionBoxes.get(session), runtime);
  const key = runtime.key;
  vault.dispose(); assert.ok(key.every(b => b === 0));
});

test('state checks and password-only security never access the macOS keychain', async t => {
  let probes = 0;
  const { vault } = await fixture(t, {
    platform: 'darwin', safeStorage: { isEncryptionAvailable: () => { probes++; return false; }, encryptString: () => { throw new Error('must not encrypt'); } },
    systemPreferences: { canPromptTouchID: () => true, promptTouchID: async () => { throw new Error('must not prompt'); } },
  });
  for (let i = 0; i < 20; i++) assert.equal(vault.state().touchAvailable, true);
  await vault.enable(secret, { touchEnabled: false });
  vault.lock(); await vault.unlock('password', secret);
  assert.equal(probes, 0);
  await assert.rejects(vault.configure(secret, { touchEnabled: true }), /无法使用 Touch ID/);
  assert.equal(probes, 1); assert.equal(vault.state().touchEnabled, false);
});
