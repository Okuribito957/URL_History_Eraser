// T0 / T1：即时清除与补删

import { MAX_TAB_URLS, RE_ERASE_DELAY_MS, SESSION_KEYS } from '../shared/constants.js';
import { matchUrl } from '../shared/matcher.js';
import { createMutex } from '../shared/store.js';
import { markDeleteFailed, markDeleteOk, updateTabIcon } from './indicator.js';
import { getState } from './state.js';
import { trackTabUrl } from './tab-tracker.js';
import { run } from './util.js';

const queueLock = createMutex();
/** @type {ReturnType<typeof setTimeout> | null} */
let reEraseTimer = null;

/**
 * 删除一个 URL 的全部历史。必须传入历史 / 事件给出的原始 URL
 * @param {string} url
 * @returns {Promise<boolean>} 是否成功
 */
export async function eraseUrl(url) {
  try {
    await chrome.history.deleteUrl({ url });
    await markDeleteOk();
    return true;
  } catch (e) {
    // 策略禁止删除历史等情况下，向用户告警
    await markDeleteFailed(e);
    return false;
  }
}

/**
 * T0：历史写入后立即触发
 * @param {chrome.history.HistoryItem} item
 */
export async function onVisited(item) {
  if (!item?.url) return;
  const { index, settings } = await getState();
  if (!settings.enabled) return;
  // 插件自身的设置页等在标签页中打开时也会进入历史，一并删除，避免暴露插件的存在
  if (item.url.startsWith(chrome.runtime.getURL(''))) {
    await eraseUrl(item.url);
    return;
  }
  if (!matchUrl(index, item.url)) return;
  await eraseUrl(item.url);
}

/**
 * T1：标签页的 URL、加载状态、标题或 favicon 变化时触发
 * @param {number} tabId
 * @param {chrome.tabs.TabChangeInfo} changeInfo
 * @param {chrome.tabs.Tab} tab
 */
export async function onTabUpdated(tabId, changeInfo, tab) {
  const relevant =
    'url' in changeInfo || 'status' in changeInfo || 'title' in changeInfo || 'favIconUrl' in changeInfo;
  if (!relevant) return;

  // 导航后 Chrome 会重置按标签页设置的图标，所以每次都重新设置
  if ('url' in changeInfo || 'status' in changeInfo) await updateTabIcon(tabId, tab.url);

  const { index, settings } = await getState();
  if (!settings.enabled || !tab.url) return;
  if (!matchUrl(index, tab.url)) return;

  await trackTabUrl(tabId, tab.url); // 在内存中记录该标签页访问过的受保护 URL
  await eraseUrl(tab.url); // 兜底 404 等 onVisited 不触发的情况
  await scheduleReErase(tab.url); // 2 秒后再删一次，清掉 favicon 等延迟写入
}

/**
 * 把 URL 加入补删队列并启动定时器。
 * 定时器不随新任务重置，避免标题不断变化的页面让补删永远不执行
 * @param {string} url
 */
export async function scheduleReErase(url) {
  await queueLock(async () => {
    const data = await chrome.storage.session.get(SESSION_KEYS.PENDING_RE_ERASE);
    /** @type {string[]} */
    const queue = data[SESSION_KEYS.PENDING_RE_ERASE] ?? [];
    if (queue.includes(url)) return;
    queue.push(url);
    await chrome.storage.session.set({
      [SESSION_KEYS.PENDING_RE_ERASE]: queue.slice(-MAX_TAB_URLS),
    });
  });
  if (reEraseTimer === null) {
    reEraseTimer = setTimeout(() => {
      reEraseTimer = null;
      run(flushReErase, 'flushReErase');
    }, RE_ERASE_DELAY_MS);
  }
}

/**
 * 执行补删队列。Service Worker 重启后也会调用一次，处理被中断的队列
 */
export async function flushReErase() {
  const urls = await queueLock(async () => {
    const data = await chrome.storage.session.get(SESSION_KEYS.PENDING_RE_ERASE);
    /** @type {string[]} */
    const queue = data[SESSION_KEYS.PENDING_RE_ERASE] ?? [];
    if (queue.length) await chrome.storage.session.remove(SESSION_KEYS.PENDING_RE_ERASE);
    return queue;
  });
  for (const url of urls) await eraseUrl(url);
}
