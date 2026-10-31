const { t: tr } = require('./locale.cjs');
const presets = require('../shared/themes.json');
const colorKeys = Object.keys(presets[0].colors);
const defaults = () => ({ themeId: 'harbor', colors: { ...presets[0].colors }, fontFamily: '"SF Mono", Menlo, Monaco, monospace', fontSize: 13, lineHeight: 1.45, letterSpacing: 0, fontWeight: '400', cursorStyle: 'block', cursorBlink: true, boldAsBright: true, shellStyle: true, customThemes: [] });
function palette(input) {
  if (!input || colorKeys.some((key) => !/^#[0-9a-fA-F]{6}$/.test(input[key]))) throw new Error(tr("所有颜色必须使用六位 HEX 格式，例如 #78d9b0"));
  return Object.fromEntries(colorKeys.map((key) => [key, input[key].toLowerCase()]));
}
function validateAppearance(input) {
  if (!input || typeof input !== 'object') throw new Error(tr("外观配置无效"));
  const value = defaults();
  for (const [key, min, max] of [['fontSize', 10, 28], ['lineHeight', 1, 1.8], ['letterSpacing', 0, 3]]) {
    if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error(tr("{0} 超出支持的范围", [key]));
    value[key] = input[key];
  }
  if (typeof input.fontFamily !== 'string' || !input.fontFamily.trim() || input.fontFamily.length > 200 || /[\n\r\0;{}<>]/.test(input.fontFamily)) throw new Error(tr("字体名称无效"));
  value.fontFamily = input.fontFamily.trim();
  if (!['400', '500', '600'].includes(input.fontWeight) || !['block', 'bar', 'underline'].includes(input.cursorStyle)) throw new Error(tr("字体或光标设置无效"));
  value.fontWeight = input.fontWeight;
  value.cursorStyle = input.cursorStyle;
  value.cursorBlink = input.cursorBlink === true;
  value.boldAsBright = input.boldAsBright === true;
  value.shellStyle = input.shellStyle !== false;
  value.colors = palette(input.colors);
  if (!Array.isArray(input.customThemes) || input.customThemes.length > 12) throw new Error(tr("最多保存 12 个自定义主题"));
  const ids = new Set(presets.map((p) => p.id));
  value.customThemes = input.customThemes.map((theme) => {
    if (!theme || !/^custom-[a-f0-9-]{36}$/.test(theme.id) || ids.has(theme.id) || typeof theme.name !== 'string' || !theme.name.trim() || theme.name.trim().length > 30) throw new Error(tr("自定义主题名称或标识无效"));
    ids.add(theme.id);
    return { id: theme.id, name: theme.name.trim(), colors: palette(theme.colors) };
  });
  if (!ids.has(input.themeId)) throw new Error(tr("主题不存在"));
  value.themeId = input.themeId;
  return value;
}
module.exports = { defaults, validateAppearance };
