import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as tr, useLanguage } from './i18n.jsx';

function ActionIcon({ action }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{action === 'new' ? <path d="M12 5v14M5 12h14"/> : action === 'edit' ? <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/> : <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>}</svg>;
}

export function ServerActionsMenu({ server, anchor, onClose, onAction }) {
  useLanguage();
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const menu = ref.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.right - menu.width, window.innerWidth - menu.width - 8)), top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.height - 8)) });
    ref.current.querySelector('button')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = e => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const close = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [anchor, onClose]);
  return createPortal(<div ref={ref} className="terminal-context server-actions-menu" style={position} role="menu" aria-label={tr('服务器操作')} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.focus(); }
    if (e.key === 'Tab') { onClose(); anchor.focus(); }
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault(); const items = [...ref.current.querySelectorAll('button')]; const index = items.indexOf(document.activeElement);
      items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  }}>
    <div className="terminal-menu-caption" title={server.name}>{server.name}</div>
    {[['new', tr('新建')], ['edit', tr('修改')], ['delete', tr('删除')]].map(([action, label]) => <React.Fragment key={action}>{action === 'delete' && <div role="separator"/>}<button role="menuitem" className={action === 'delete' ? 'server-action-delete' : ''} onClick={() => { onClose(); onAction(action, server); }}><ActionIcon action={action}/><span>{label}</span></button></React.Fragment>)}
  </div>, document.body);
}

export function DeleteServerDialog({ server, onClose, onDelete }) {
  useLanguage();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  return <div className="modal-overlay" onPointerDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <section ref={ref} className="modal server-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="server-delete-title" onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); }
      if (e.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
        if (!items.length) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
      }
    }}>
      <h2 id="server-delete-title">{tr('删除服务器')}</h2>
      <p className="delete-server-name">{server.name}</p>
      <p className="form-note">{tr('仅删除保存的连接配置，已打开的标签页和远程任务不会关闭。')}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-footer"><div className="spacer"/><button className="secondary" disabled={busy} onClick={onClose}>{tr('取消')}</button><button className="secondary server-action-delete" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(server.id); } catch (e) { setError(e.message); setBusy(false); } }}>{tr('确认删除配置')}</button></div>
    </section>
  </div>;
}
