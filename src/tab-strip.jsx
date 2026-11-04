import React, { useLayoutEffect, useRef, useState } from 'react';
import { t as tr, useLanguage } from './i18n.jsx';

export function TabStrip({ activeId, count, sort, children, newButton }) {
  useLanguage();
  const viewport = useRef(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => {
      const end = element.scrollWidth - element.clientWidth;
      const next = { overflow: end > 1, left: element.scrollLeft > 1, right: element.scrollLeft < end - 1 };
      setEdges(old => Object.keys(next).every(key => next[key] === old[key]) ? old : next);
    };
    const reveal = () => {
      const selected = element.querySelector('.tab.selected');
      if (!selected || element.querySelector('[data-sort-dragging]')) return;
      const box = selected.getBoundingClientRect(), view = element.getBoundingClientRect();
      if (box.left < view.left) element.scrollLeft -= view.left - box.left;
      else if (box.right > view.right) element.scrollLeft += box.right - view.right;
    };
    // Use a non-passive listener so vertical wheels scroll this horizontal strip.
    const wheel = event => {
      if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      element.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
    };
    const observer = new ResizeObserver(() => { reveal(); measure(); });
    observer.observe(element);
    reveal(); measure();
    element.addEventListener('scroll', measure, { passive: true });
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); element.removeEventListener('wheel', wheel); };
  }, [activeId, count]);
  const scroll = direction => viewport.current.scrollBy({ left: direction * viewport.current.clientWidth * .75, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const arrow = direction => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={direction < 0 ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}/></svg>;
  return <div className="tabbar">
    {edges.overflow && <button className="tab-scroll" disabled={!edges.left} aria-label={tr('向左滚动标签页')} title={tr('向左滚动标签页')} onClick={() => scroll(-1)}>{arrow(-1)}</button>}
    <div className="tabs" ref={viewport} role="tablist" {...sort}>{children}</div>
    {edges.overflow && <button className="tab-scroll" disabled={!edges.right} aria-label={tr('向右滚动标签页')} title={tr('向右滚动标签页')} onClick={() => scroll(1)}>{arrow(1)}</button>}
    {newButton}
  </div>;
}
