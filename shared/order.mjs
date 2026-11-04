// Move one item relative to another while retaining object identity and hidden items.
export function moveItem(items, id, targetId, after = false) {
  if (id === targetId || !items.some(item => item.id === id) || !items.some(item => item.id === targetId)) return items;
  const moved = items.find(item => item.id === id);
  const next = items.filter(item => item.id !== id);
  next.splice(next.findIndex(item => item.id === targetId) + (after ? 1 : 0), 0, moved);
  return next;
}
