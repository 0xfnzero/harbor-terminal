require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateAppearance } = require('../electron/appearance.cjs');
const presets = require('../shared/themes.json');

test('every bundled theme is complete and settings round-trip without palette loss', () => {
  for (const theme of presets) {
    const value = { ...defaults(), themeId: theme.id, colors: theme.colors };
    assert.deepEqual(validateAppearance(value), value);
    assert.equal(Object.keys(value.colors).length, 21);
  }
});
test('rejects malformed saved appearance instead of passing invalid values to xterm', () => {
  for (const extra of [{ fontSize: 500 }, { lineHeight: 0 }, { letterSpacing: -1 }, { fontWeight: '900' }, { cursorStyle: 'invalid' }, { themeId: 'missing' }, { colors: {} }, { fontFamily: 'bad\nfont' }]) {
    assert.throws(() => validateAppearance({ ...defaults(), ...extra }));
  }
});
test('custom themes persist independently and duplicate identifiers are rejected', () => {
  const value = defaults();
  const theme = { id: 'custom-12345678-1234-1234-1234-123456789abc', name: 'My theme', colors: { ...value.colors, background: '#000011' } };
  value.customThemes.push(theme);
  value.themeId = theme.id;
  value.colors = theme.colors;
  assert.deepEqual(validateAppearance(value), value);
  value.customThemes.push(theme);
  assert.throws(() => validateAppearance(value));
  assert.equal(defaults().customThemes.length, 0);
});
