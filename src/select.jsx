import { t as tr, useLanguage } from './i18n.jsx';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Select({ value, onChange, children, disabled, ...props }) {
  useLanguage();
  const id = useId();
  const button = useRef(null);
  const menu = useRef(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({});
  const options = React.Children.toArray(children).filter(React.isValidElement).map(child => ({ value: String(child.props.value ?? ''), label: child.props.children, disabled: child.props.disabled }));
  const selected = options.findIndex(option => option.value === String(value));
  const enabled = options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0);
  const label = props['aria-label'] || props.name;
  function show() { if (!disabled) { setHighlight(selected >= 0 && !options[selected].disabled ? selected : enabled[0] ?? 0); setOpen(true); } }
  function choose(index) {
    if (!options[index] || options[index].disabled) return;
    onChange?.({ target: { value: options[index].value } });
    setOpen(false); button.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const rect = button.current.getBoundingClientRect();
    const height = Math.min(options.length * 42 + 12, 260);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < height && above > below;
    setPosition({ position: 'fixed', left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), width: rect.width, maxHeight: Math.min(260, Math.max(80, up ? above : below)), ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!button.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const scroll = e => { if (!menu.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', scroll);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', scroll); document.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useEffect(() => {
    if (!open || !menu.current) return;
    const list = menu.current;
    const item = list.children[highlight];
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [highlight, open]);
  function key(event) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
    if (event.key === 'Escape') { if (open) { event.stopPropagation(); setOpen(false); } return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') { open ? choose(highlight) : show(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (!open) { show(); return; }
      const current = enabled.indexOf(highlight);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setHighlight(enabled[next] ?? 0);
    }
  }
  return <><button {...props} type="button" ref={button} className={`select-trigger ${props.className || ''}`} role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${highlight}` : undefined} disabled={disabled} onKeyDown={key} onClick={() => open ? setOpen(false) : show()}><span>{options[selected]?.label ?? tr("请选择")}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>{open && createPortal(<div id={id} ref={menu} role="listbox" aria-label={label} className="select-menu" style={position}>{options.map((option, i) => <div key={option.value} id={`${id}-${i}`} role="option" data-value={option.value} aria-selected={i === selected} aria-disabled={Boolean(option.disabled)} className={`select-option ${i === highlight ? 'highlighted' : ''}`} onPointerMove={() => !option.disabled && setHighlight(i)} onPointerDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); choose(i); }}><span>{option.label}</span>{i === selected && <span className="select-check" aria-hidden="true">✓</span>}</div>)}</div>, button.current?.closest('[role="dialog"]') || document.body)}</>;
}
