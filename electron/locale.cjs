const messages = require('../shared/messages.json');
let language = 'en';
function validateLanguage(value) {
  if (value !== 'zh-CN' && value !== 'en') throw new Error(t('不支持的界面语言'));
  return value;
}
function setLanguage(value) { language = validateLanguage(value); return language; }
function getLanguage() { return language; }
function t(source, args = []) {
  const pattern = language === 'en' && Object.hasOwn(messages, source) ? messages[source] : source;
  return typeof pattern === 'string' ? pattern.replace(/\{(\d+)\}/g, (match, index) => index < args.length ? String(args[index]) : match) : '';
}
module.exports = { t, getLanguage, setLanguage, validateLanguage };
