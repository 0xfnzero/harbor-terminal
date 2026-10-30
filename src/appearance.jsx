import { t as tr, useLanguage } from './i18n.jsx';
import { Select } from './select.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import presets from '../shared/themes.json';

export const defaultAppearance = { themeId: 'harbor', colors: { ...presets[0].colors }, fontFamily: '"SF Mono", Menlo, Monaco, monospace', fontSize: 13, lineHeight: 1.45, letterSpacing: 0, fontWeight: '400', cursorStyle: 'block', cursorBlink: true, boldAsBright: true, customThemes: [] };
export function terminalOptions(value) {
  const colors = Object.fromEntries(Object.keys(presets[0].colors).map((key) => [key, /^#[0-9a-fA-F]{6}$/.test(value.colors[key]) ? value.colors[key] : presets[0].colors[key]]));
  return { theme: colors, fontFamily: value.fontFamily || defaultAppearance.fontFamily, fontSize: value.fontSize, fontWeight: value.fontWeight, fontWeightBold: '700', lineHeight: value.lineHeight, letterSpacing: value.letterSpacing, cursorStyle: value.cursorStyle, cursorBlink: value.cursorBlink, drawBoldTextInBrightColors: value.boldAsBright };
}

const sample = '\x1b[1;32mharbor\x1b[0m \x1b[36m~/workspace\x1b[0m \x1b[35m main*\x1b[0m\r\n$ npm run build\r\n\r\n\x1b[32m✓\x1b[0m Compiled successfully in \x1b[33m128ms\x1b[0m\r\n\x1b[90m19 modules · ready for your next idea\x1b[0m\r\n\x1b[33mWARN\x1b[0m  Preview only — no commands are executed\r\n\x1b[31mERROR\x1b[0m Example error highlight\r\n\r\n' + Array.from({ length: 16 }, (_, i) => `\x1b[${i < 8 ? 40 + i : 100 + i - 8}m  \x1b[0m `).join('') + '\r\n\r\n$ ';

function Preview({ value }) {
  useLanguage();
  const host = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  useEffect(() => {
    const terminal = new Terminal({ ...terminalOptions(value), cols: 64, rows: 15, scrollback: 0, disableStdin: true });
    const addon = new FitAddon();
    terminal.loadAddon(addon);
    terminal.open(host.current);
    addon.fit();
    terminal.write(sample);
    term.current = terminal;
    fit.current = addon;
    const observer = new ResizeObserver(() => addon.fit());
    observer.observe(host.current);
    return () => { observer.disconnect(); term.current = null; fit.current = null; terminal.dispose(); };
  }, []);
  useEffect(() => {
    if (term.current) term.current.options = terminalOptions(value);
    const frame = requestAnimationFrame(() => fit.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <div className="appearance-preview" style={{ background: terminalOptions(value).theme.background }} ref={host} aria-label={tr("终端样式实时预览")}/>;
}

const colorLabels = { background: '背景', foreground: '正文', cursor: '光标', cursorAccent: '光标文字', selectionBackground: '选区', black: '黑色', red: '红色 / 错误', green: '绿色 / 成功', yellow: '黄色 / 警告', blue: '蓝色', magenta: '紫色', cyan: '青色', white: '白色', brightBlack: '亮黑 / 注释', brightRed: '亮红', brightGreen: '亮绿', brightYellow: '亮黄', brightBlue: '亮蓝', brightMagenta: '亮紫', brightCyan: '亮青', brightWhite: '亮白' };

export function AppearanceDialog({ value, onClose, onSave }) {
  useLanguage();
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const modal = useRef(null);
  const set = (key, next) => setDraft((prev) => ({ ...prev, [key]: next }));
  const allThemes = [...presets, ...draft.customThemes];
  const selected = allThemes.find((t) => t.id === draft.themeId);
  const customized = selected && Object.keys(selected.colors).some((key) => selected.colors[key].toLowerCase() !== draft.colors[key].toLowerCase());
  useEffect(() => {
    const previous = document.activeElement;
    modal.current?.focus();
    const listener = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = [...modal.current.querySelectorAll('button:not(:disabled), input, select, summary')].filter((node) => node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', listener);
    return () => { window.removeEventListener('keydown', listener); previous?.focus(); };
  }, []);
  function saveTemplate() {
    if (!name.trim()) { setError(tr("请先为你的主题起个名字")); return; }
    if (draft.customThemes.length >= 12) { setError(tr("最多保存 12 个自定义主题")); return; }
    if (Object.values(draft.colors).some((color) => !/^#[0-9a-fA-F]{6}$/.test(color))) { setError(tr("请先修正颜色的 HEX 格式")); return; }
    const theme = { id: 'custom-' + crypto.randomUUID(), name: name.trim(), colors: { ...draft.colors } };
    setDraft((prev) => ({ ...prev, themeId: theme.id, customThemes: [...prev.customThemes, theme] }));
    setName(''); setError('');
  }
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(draft); } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <div className="modal-overlay appearance-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={modal} tabIndex={-1} className="appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title" onSubmit={submit}>
      <div className="appearance-heading"><div><div className="eyebrow">{tr("随心定制")}</div><h2 id="appearance-title">{tr("终端外观")}</h2><p>{tr("为每一次专注，选一种喜欢的风格。")}</p></div><button type="button" className="icon-button" aria-label={tr("关闭外观设置")} onClick={onClose}>✕</button></div>
      <div className="appearance-body"><div className="appearance-controls">
        <div className="appearance-section-title">{tr("风格模板 ")}<span>{presets.length}{tr(" 种预设 · 即选即预览")}</span></div>
        <div className="theme-grid">{allThemes.map((theme) => <button type="button" className={`theme-card ${draft.themeId === theme.id ? 'chosen' : ''}`} aria-label={tr("选择 {0} 主题", [theme.name])} aria-pressed={draft.themeId === theme.id} key={theme.id} onClick={() => { setDraft((prev) => ({ ...prev, themeId: theme.id, colors: { ...theme.colors } })); setError(''); }}><div className="theme-mini" style={{ background: theme.colors.background, color: theme.colors.foreground }}><span style={{ color: theme.colors.green }}>❯</span> <span style={{ color: theme.colors.blue }}>~/harbor</span><div>{['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'].map((color) => <i key={color} style={{ background: theme.colors[color] }}/>)}</div></div><strong>{theme.name}</strong><small>{tr(theme.description || '我的主题')}{draft.themeId === theme.id ? ' ✓' : ''}</small></button>)}</div>
        <div className="appearance-section-title">{tr("字体与排版")}</div>
        <label className="setting-field">{tr("字体")}<Select aria-label={tr("终端字体")} value={['"SF Mono", Menlo, Monaco, monospace', 'Menlo, monospace', 'Monaco, monospace', '"JetBrains Mono", monospace', '"Fira Code", monospace'].includes(draft.fontFamily) ? draft.fontFamily : 'custom'} onChange={(e) => set('fontFamily', e.target.value === 'custom' ? 'monospace' : e.target.value)}><option value={'"SF Mono", Menlo, Monaco, monospace'}>{tr("系统等宽 · SF Mono")}</option><option value="Menlo, monospace">Menlo</option><option value="Monaco, monospace">Monaco</option><option value={'"JetBrains Mono", monospace'}>{tr("JetBrains Mono（需本机安装）")}</option><option value={'"Fira Code", monospace'}>{tr("Fira Code（需本机安装）")}</option><option value="custom">{tr("自定义字体")}</option></Select></label>
        <label className="setting-field">{tr("字体名称")}<input aria-label={tr("自定义字体名称")} required maxLength={200} value={draft.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}/><small>{tr("使用本机已安装字体；不存在时使用等宽字体回退。")}</small></label>
        <div className="setting-grid"><label className="setting-field">{tr("字号 ")}<span>{draft.fontSize}px</span><input aria-label={tr("终端字号")} type="range" min="10" max="28" step="1" value={draft.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))}/></label><label className="setting-field">{tr("行距 ")}<span>{draft.lineHeight.toFixed(2)}</span><input aria-label={tr("终端行距")} type="range" min="1" max="1.8" step="0.05" value={draft.lineHeight} onChange={(e) => set('lineHeight', Number(e.target.value))}/></label><label className="setting-field">{tr("字间距 ")}<span>{draft.letterSpacing}px</span><input aria-label={tr("终端字间距")} type="range" min="0" max="3" step="0.5" value={draft.letterSpacing} onChange={(e) => set('letterSpacing', Number(e.target.value))}/></label><label className="setting-field">{tr("字重")}<Select aria-label={tr("终端字重")} value={draft.fontWeight} onChange={(e) => set('fontWeight', e.target.value)}><option value="400">{tr("常规 400")}</option><option value="500">{tr("中等 500")}</option><option value="600">{tr("加粗 600")}</option></Select></label></div>
        <div className="appearance-section-title">{tr("光标与高亮")}</div>
        <label className="setting-field">{tr("光标形状")}<Select aria-label={tr("光标形状")} value={draft.cursorStyle} onChange={(e) => set('cursorStyle', e.target.value)}><option value="block">{tr("方块")}</option><option value="bar">{tr("竖线")}</option><option value="underline">{tr("下划线")}</option></Select></label>
        <label className="appearance-check"><input type="checkbox" checked={draft.cursorBlink} onChange={(e) => set('cursorBlink', e.target.checked)}/>{tr("光标闪烁")}</label><label className="appearance-check"><input type="checkbox" checked={draft.boldAsBright} onChange={(e) => set('boldAsBright', e.target.checked)}/>{tr("使用亮色显示 ANSI 加粗文本")}</label>
        <details className="palette-details"><summary>{tr("自定义配色 ")}<span>{tr("正文、选区与 16 色 ANSI 色板")}</span></summary><div className="color-grid">{Object.entries(colorLabels).map(([key, label]) => <label className="color-field" key={key}><span>{tr(label)}</span><div><input type="color" aria-label={tr("{0}颜色选择器", [tr(label)])} value={/^#[0-9a-fA-F]{6}$/.test(draft.colors[key]) ? draft.colors[key] : '#000000'} onChange={(e) => set('colors', { ...draft.colors, [key]: e.target.value })}/><input aria-label={`${tr(label)} HEX`} pattern="#[0-9a-fA-F]{6}" required value={draft.colors[key]} onChange={(e) => set('colors', { ...draft.colors, [key]: e.target.value })}/></div></label>)}</div></details>
        <div className="save-template"><label className="setting-field">{tr("保存自己的配色模板")}<input aria-label={tr("自定义主题名称")} maxLength={30} placeholder={tr("例如：我的深夜工作台")} value={name} onChange={(e) => setName(e.target.value)}/></label><button type="button" className="secondary" onClick={saveTemplate}>{tr("保存为我的主题")}</button><small>{tr("点击下方「应用并保存」后持久保存，最多 12 个。")}</small></div>
      </div><aside className="preview-column"><div className="preview-label"><span className="dot green"/>{tr("实时预览")} <span>{selected?.name}{customized ? tr(" · 已自定义") : ''}</span></div><Preview value={draft}/><div className="preview-note"><strong>{tr("让颜色服务于阅读")}</strong><p>{tr("预览包含成功、警告、错误与 ANSI 色板。应用后，所有已打开和新建的终端立即使用这套样式。")}</p><p>{tr("颜色高亮遵循命令输出的 ANSI 标记。输入语法高亮由 Shell 配置提供。")}</p></div><div className="preview-spec"><span>{draft.fontSize}px</span><span>{draft.lineHeight.toFixed(2)}{tr(" 行距")}</span><span>{tr("16 色 ANSI")}</span></div></aside></div>
      <div className="appearance-bottom">{error && <div className="error" role="alert">{error}</div>}<div className="appearance-actions"><button type="button" className="reset-appearance" onClick={() => setDraft({ ...structuredClone(defaultAppearance), customThemes: draft.customThemes })}>{tr("恢复默认外观")}</button><div className="spacer"/><button type="button" className="secondary" onClick={onClose}>{tr("取消")}</button><button type="submit" className="primary" disabled={saving}>{saving ? tr("保存中…") : tr("应用并保存")}</button></div></div>
    </form>
  </div>;
}
