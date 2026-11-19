// 界面文案的多语言工具

/**
 * 取出 i18n 文案；找不到时返回键名本身，方便发现遗漏
 * @param {string} key
 * @param {string | string[]} [subs]
 */
export function t(key, subs) {
  const msg = chrome.i18n.getMessage(key, subs);
  return msg || key;
}

/**
 * 把页面中带 data-i18n 系列属性的元素替换为对应文案
 * - data-i18n: textContent
 * - data-i18n-title: title 属性
 * - data-i18n-placeholder: placeholder 属性
 * @param {ParentNode} [root]
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  }
  document.documentElement.lang = chrome.i18n.getUILanguage();
}

/**
 * 把时间戳格式化为本地时间；0 表示从未执行
 * @param {number} ms
 */
export function formatTime(ms) {
  if (!ms) return t('never');
  return new Date(ms).toLocaleString(chrome.i18n.getUILanguage());
}
