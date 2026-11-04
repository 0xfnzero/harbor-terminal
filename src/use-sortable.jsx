import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { moveItem } from '../shared/order.mjs';

// Pointer capture lets users release past a row or outside the narrow tab strip.
// Preview locally; persist one move on release, and discard it on Escape/cancel.
export function useSortable({ axis, enabled = true, onMove }) {
  const drag = useRef(null);
  const suppressClickUntil = useRef(0);
  const [preview, setPreview] = useState(null);
  const moveRef = useRef(onMove); moveRef.current = onMove;
  const finish = (commit = false) => {
    const current = drag.current;
    drag.current = null; setPreview(null);
    if (!current) return;
    cancelAnimationFrame(current.frame);
    current.ghost?.remove();
    document.body.classList.remove('sorting-active');
    for (const row of current.container.children) for (const animation of row.getAnimations()) animation.cancel();
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (current.active) suppressClickUntil.current = Date.now() + 200;
    if (commit && current.active && current.target.id !== current.id) moveRef.current(current.id, current.target.id, current.target.after);
  };
  useEffect(() => {
    const cancel = event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(); } };
    window.addEventListener('keydown', cancel, true);
    return () => { window.removeEventListener('keydown', cancel, true); if (drag.current) { cancelAnimationFrame(drag.current.frame); drag.current.ghost?.remove(); document.body.classList.remove('sorting-active'); } };
  }, []);
  useEffect(() => { if (!enabled) finish(); }, [enabled]);
  useLayoutEffect(() => {
    const current = drag.current;
    if (!current?.before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const row of current.container.children) {
      const previous = current.before.get(row.dataset.sortId);
      for (const animation of row.getAnimations()) animation.cancel();
      if (!previous || row.dataset.sortId === current.id) continue;
      const next = row.getBoundingClientRect();
      const x = previous.left - next.left, y = previous.top - next.top;
      if (Math.abs(x) + Math.abs(y) > 1) row.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    current.before = null;
  }, [preview]);
  const update = () => {
    const current = drag.current;
    if (!current?.active) return;
    const scroll = axis === 'x' ? current.container.scrollLeft : current.container.scrollTop;
    const center = current.center + current.point - current.start + scroll - current.scroll;
    let index = current.index;
    const direction = center >= current.center ? 1 : -1;
    // A little under half a slot is enough; users need not cross an exact pixel.
    while (index + direction >= 0 && index + direction < current.slots.length) {
      const next = index + direction;
      const threshold = current.slots[index].center + (current.slots[next].center - current.slots[index].center) * .45;
      if (direction > 0 ? center < threshold : center > threshold) break;
      index = next;
    }
    const target = { id: current.slots[index].id, after: index > current.index };
    if (!current.previewed || current.target.id !== target.id || current.target.after !== target.after) {
      current.before = new Map([...current.container.children].filter(row => row.dataset.sortId).map(row => [row.dataset.sortId, row.getBoundingClientRect()]));
      current.target = target; current.previewed = true;
      setPreview({ source: current.id, ...target });
    }
  };
  const scrollFrame = () => {
    const current = drag.current;
    if (!current?.active) return;
    const box = current.container.getBoundingClientRect();
    const start = axis === 'x' ? box.left : box.top, end = axis === 'x' ? box.right : box.bottom;
    const step = current.point < start + 30 ? -12 : current.point > end - 30 ? 12 : 0;
    if (step) {
      if (axis === 'x') current.container.scrollLeft += step; else current.container.scrollTop += step;
      update();
    }
    current.frame = requestAnimationFrame(scrollFrame);
  };
  return {
    ordered: items => preview ? moveItem(items, preview.source, preview.id, preview.after) : items,
    row: id => ({
      'data-sort-id': id,
      'data-sort-dragging': preview?.source === id ? 'true' : undefined,
      onClickCapture: event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } },
    }),
    handle: id => ({
      draggable: false,
      'data-sort-handle': enabled ? 'true' : undefined,
      onPointerDown: event => {
        if (!enabled || event.button !== 0 || !event.isPrimary) return;
        const handle = event.currentTarget, container = handle.closest('[data-sort-container]');
        const slots = [...container.children].filter(row => row.dataset.sortId).map(row => {
          const box = row.getBoundingClientRect();
          return { id: row.dataset.sortId, center: axis === 'x' ? box.left + box.width / 2 : box.top + box.height / 2 };
        });
        const index = slots.findIndex(slot => slot.id === id);
        if (index < 0) return;
        const point = axis === 'x' ? event.clientX : event.clientY;
        drag.current = { id, handle: container, origin: handle, startX: event.clientX, startY: event.clientY, container, slots, index, center: slots[index].center, start: point, point, scroll: axis === 'x' ? container.scrollLeft : container.scrollTop, pointerId: event.pointerId, active: false, target: { id, after: false } };
        container.setPointerCapture(event.pointerId);
      },

    }),
    container: { 'data-sort-container': axis,
      onPointerMove: event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.point = axis === 'x' ? event.clientX : event.clientY;
        if (!current.active && Math.abs(current.point - current.start) < 6) return;
        event.preventDefault();
        if (!current.active) {
          current.active = true; suppressClickUntil.current = Infinity;
          const row = current.origin.closest('[data-sort-id]'), box = row.getBoundingClientRect();
          const ghost = row.cloneNode(true);
          ghost.removeAttribute('data-sort-id'); ghost.removeAttribute('data-sort-dragging');
          ghost.classList.add('sort-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
          Object.assign(ghost.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, minWidth: '0', maxWidth: 'none', margin: '0' });
          document.body.appendChild(ghost); current.ghost = ghost;
          document.body.classList.add('sorting-active');
          current.frame = requestAnimationFrame(scrollFrame);
        }
        current.ghost.style.transform = `translate3d(${event.clientX - current.startX}px, ${event.clientY - current.startY}px, 0)`;
        update();
      },
      onPointerUp: event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const box = current.origin.getBoundingClientRect();
        const click = !current.active && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        finish(true);
        if (click) current.origin.click();
      },
      onPointerCancel: () => finish(),
      onLostPointerCapture: () => { if (drag.current) finish(); },
    },
  };
}
