import { useSyncExternalStore } from 'react';
import messages from '../shared/messages.json';
let language = 'en';
const subscribers = new Set();
function applyLanguage(next) {
  if (next !== 'zh-CN' && next !== 'en') throw new Error('Unsupported interface language');
  language = next;
  document.documentElement.lang = next;
  for (const notify of subscribers) notify();
}
export async function initializeLanguage() {
  if (window.harbor?.getLanguage) applyLanguage(await window.harbor.getLanguage());
}
export async function changeLanguage(next) {
  if (!window.harbor?.setLanguage) throw new Error(t('请在桌面客户端中切换语言'));
  applyLanguage(await window.harbor.setLanguage(next));
}
const subscribe = callback => { subscribers.add(callback); return () => subscribers.delete(callback); };
export function useLanguage() { return useSyncExternalStore(subscribe, () => language); }
export function t(source, args = []) {
  const pattern = language === 'en' && Object.hasOwn(messages, source) ? messages[source] : source;
  return typeof pattern === 'string' ? pattern.replace(/\{(\d+)\}/g, (match, index) => index < args.length ? String(args[index]) : match) : '';
}
