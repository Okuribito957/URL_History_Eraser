// 工具栏图标、徽标，以及"删除被策略禁止"状态的管理

import { matchUrl } from '../shared/matcher.js';
import { getMeta, updateMeta } from '../shared/store.js';
import { getState } from './state.js';

const ICON_DEFAULT = { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' };
const ICON_ON = { 16: '/icons/icon-on-16.png', 32: '/icons/icon-on-32.png' };

const BLOCKED_RE = /not allowed to be deleted/i;

/** 删除是否被禁止。null 表示尚未从 storage 读取 */
let blocked = /** @type {boolean | null} */ (null);

export async function isDeleteBlocked() {
  if (blocked === null) blocked = (await getMeta()).deleteBlocked;
  return blocked;
}

/** 删除成功：如果之前标记过"被禁止"则解除 */
export async function markDeleteOk() {
  if (await isDeleteBlocked()) {
    blocked = false;
    await updateMeta({ deleteBlocked: false });
  }
}

/**
 * 删除失败：策略禁止时标记并告警，其他错误只记日志
 * @param {unknown} error
 * @returns {Promise<boolean>} 是否为"被禁止"
 */
export async function markDeleteFailed(error) {
  const message = String(/** @type {any} */ (error)?.message ?? error);
  if (!BLOCKED_RE.test(message)) {
    console.warn('[UHE] deleteUrl failed:', message);
    return false;
  }
  if (!(await isDeleteBlocked())) {
    blocked = true;
    await updateMeta({ deleteBlocked: true });
  }
  return true;
}

/**
 * storage 中的 meta 被修改时同步内存状态
 * @param {boolean} value
 */
export function syncBlockedFlag(value) {
  blocked = Boolean(value);
}

/** 根据全局开关和"被禁止"状态更新徽标 */
export async function refreshBadge() {
  const [{ settings }, meta] = await Promise.all([getState(), getMeta()]);
  if (meta.deleteBlocked) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage('badgeBlocked') });
  } else if (!settings.enabled) {
    await chrome.action.setBadgeBackgroundColor({ color: '#80868b' });
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage('badgeDisabled') });
  } else {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: chrome.i18n.getMessage('extName') });
  }
}

/**
 * 按标签页切换图标：受保护时显示彩色图标
 * @param {number} tabId
 * @param {string | undefined} url
 */
export async function updateTabIcon(tabId, url) {
  const { index, settings } = await getState();
  const on = Boolean(settings.enabled && settings.showIndicator && url && matchUrl(index, url));
  try {
    await chrome.action.setIcon({ tabId, path: on ? ICON_ON : ICON_DEFAULT });
  } catch {
    // 标签页已关闭等情况，忽略
  }
}

/** 规则或设置变化后刷新所有标签页的图标 */
export async function refreshAllTabIcons() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? null : updateTabIcon(tab.id, tab.url))));
}
