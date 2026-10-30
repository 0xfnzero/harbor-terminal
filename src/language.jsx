import React, { useState } from 'react';
import { Select } from './select.jsx';
import { t as tr, useLanguage, changeLanguage } from './i18n.jsx';
export function LanguageSwitch() {
  const language = useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function change(value) {
    setSaving(true); setError('');
    try { await changeLanguage(value); } catch { setError(tr('语言设置保存失败，请重试')); }
    finally { setSaving(false); }
  }
  return <div className="language-switch"><Select aria-label="Language / 语言" value={language} disabled={saving} onChange={e => change(e.target.value)}><option value="zh-CN">中文</option><option value="en">English</option></Select>{error && <span role="alert" className="language-error">{error}</span>}</div>;
}
