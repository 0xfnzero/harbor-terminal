import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t as tr, useLanguage } from './i18n.jsx';

function Glyph({ name }) {
  const paths = { copy: 'M9 5H5v14h10v-4M9 3h10v12H9z', paste: 'M9 4H5v17h14V4h-4M9 2h6v5H9z', selectAll: 'M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4M8 8h8v8H8z', search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', clear: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7', bottom: 'M12 3v13m-5-5 5 5 5-5M4 21h16' };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
export function TerminalContextMenu({ position, selected, mac, onAction, onClose }) {
  useLanguage();
  const ref = useRef(null);
  const shortcut = mac ? '⌘' : 'Ctrl ⇧';
  const items = [['copy', tr('复制'), `${shortcut} C`, !selected], ['paste', tr('粘贴'), `${shortcut} V`], ['selectAll', tr('全选'), `${shortcut} A`], ['search', tr('搜索终端'), `${shortcut} F`], ['bottom', tr('滚动到底部'), ''], ['clear', tr('清空滚动记录'), `${shortcut} K`]];
  useEffect(() => {
    ref.current?.querySelector('button:not(:disabled)')?.focus();
    const outside = event => { if (!ref.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', onClose); };
  }, []);
  return createPortal(<div ref={ref} className="terminal-context" role="menu" aria-label={tr('终端菜单')} style={{ left: Math.max(8, Math.min(position.x, window.innerWidth - 280)), top: Math.max(8, Math.min(position.y, window.innerHeight - 310)) }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const nodes = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const index = nodes.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
      nodes[next]?.focus();
    }
  }}>
    <div className="terminal-menu-caption">{tr('终端操作')}</div>
    {items.map(([action,label,key,disabled], index) => <React.Fragment key={action}>{[2,5].includes(index) && <div role="separator"/>}<button role="menuitem" disabled={disabled} onClick={() => onAction(action)}><Glyph name={action}/><span>{label}</span>{key && <kbd>{key}</kbd>}</button></React.Fragment>)}
  </div>, document.body);
}
export function PasteDialog({ text, onConfirm, onCancel }) {
  useLanguage();
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  return createPortal(<div className="modal-overlay terminal-paste-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="terminal-paste-title" aria-describedby="terminal-paste-description" className="terminal-paste-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
      if (event.key === 'Tab') {
        const nodes = [...ref.current.querySelectorAll('button')];
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
    }}>
      <div className="paste-heading"><div className="paste-icon"><Glyph name="paste"/></div><div><span className="eyebrow">{tr('检查剪贴板内容')}</span><h2 id="terminal-paste-title">{tr('确认多行粘贴')}</h2></div><span className="paste-count">{tr('{0} 行', [text.split(/\r\n|\r|\n/).length])}</span></div>
      <p id="terminal-paste-description">{tr('多行文本可能立即执行命令，请确认后粘贴。')}</p>
      <pre className="paste-preview">{text.slice(0,4000)}{text.length > 4000 ? '\n…' : ''}</pre>
      <div className="paste-footer"><span>{tr('仅预览，不会自动执行')}</span><button className="secondary" onClick={onCancel}>{tr('取消')}</button><button className="primary" onClick={onConfirm}>{tr('粘贴')}</button></div>
    </section>
  </div>, document.body);
}
