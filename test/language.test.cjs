const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const messages = require('../shared/messages.json');
const { t, getLanguage, setLanguage } = require('../electron/locale.cjs');
const { validateServer } = require('../electron/core.cjs');

test('English is the default; language switching changes validation without changing user values', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(t('添加服务器'), 'Add server');
  assert.throws(() => validateServer({ host: 'localhost' }), /Enter a server name/);
  const source = { name: '生产服务器', host: 'example.com', username: 'deploy' };
  assert.equal(validateServer(source).name, source.name);
  assert.equal(t('连接 {0}', ['生产服务器 {1}']), 'Connect to 生产服务器 {1}');
  assert.equal(t('unknown user text'), 'unknown user text');
  assert.throws(() => setLanguage('de'), /Unsupported/);
  assert.equal(getLanguage(), 'en');
  setLanguage('zh-CN');
  assert.equal(t('添加服务器'), '添加服务器');
  assert.throws(() => validateServer({ host: 'localhost' }), /请输入服务器名称/);
  setLanguage('en');
});

test('catalog preserves interpolation placeholders and covers every source translation', () => {
  const parameters = s => [...s.matchAll(/\{\d+\}/g)].map(m => m[0]).sort();
  for (const [source, translation] of Object.entries(messages)) {
    assert.ok(translation.trim(), `Missing English text: ${source}`);
    assert.deepEqual(parameters(translation), parameters(source), `Interpolation mismatch: ${source}`);
    assert.equal(/\p{Script=Han}/u.test(translation), false, `Untranslated English: ${source}`);
  }
  const missing = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['t','tr'].includes(node.callee?.name) && node.arguments[0]?.type === 'StringLiteral') {
      const key = node.arguments[0].value;
      if (/\p{Script=Han}/u.test(key) && !Object.hasOwn(messages, key)) missing.push(key);
    }
    for (const [key,value] of Object.entries(node)) {
      if (['loc','comments','tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  };
  for (const folder of ['src','electron']) for (const name of fs.readdirSync(path.join(__dirname, '..', folder))) {
    if (!/\.(jsx|cjs)$/.test(name)) continue;
    visit(parser.parse(fs.readFileSync(path.join(__dirname, '..', folder, name), 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx'] }));
  }
  assert.deepEqual(missing, []);
});
