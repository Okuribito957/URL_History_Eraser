// 记录每个标签页访问过的受保护 URL（仅存 storage.session，即内存）。
// 标签页关闭时，用这些 URL 清理"最近关闭的标签页"

import { MAX_TAB_URLS, SESSION_KEYS } from '../shared/constants.js';
import { createMutex } from '../shared/store.js';

const lock = createMutex();

/** @returns {Promise<Record<string, string[]>>} */
async function readMap() {
  const data = await chrome.storage.session.get(SESSION_KEYS.TAB_URLS);
  return data[SESSION_KEYS.TAB_URLS] ?? {};
}

/** @param {Record<string, string[]>} map */
async function writeMap(map) {
  await chrome.storage.session.set({ [SESSION_KEYS.TAB_URLS]: map });
}

/**
 * @param {number} tabId
 * @param {string} url
 */
export function trackTabUrl(tabId, url) {
  return lock(async () => {
    const map = await readMap();
    const list = map[tabId] ?? [];
    if (list[list.length - 1] === url) return; // 与上一条相同则不写入
    const next = list.filter((u) => u !== url);
    next.push(url);
    map[tabId] = next.slice(-MAX_TAB_URLS);
    await writeMap(map);
  });
}

/**
 * 取出并删除该标签页的记录
 * @param {number} tabId
 * @returns {Promise<string[]>}
 */
export function takeTabUrls(tabId) {
  return lock(async () => {
    const map = await readMap();
    const list = map[tabId];
    if (!list) return [];
    delete map[tabId];
    await writeMap(map);
    return list;
  });
}

/**
 * 预渲染等导致 tabId 替换时迁移记录
 * @param {number} addedTabId
 * @param {number} removedTabId
 */
export function replaceTab(addedTabId, removedTabId) {
  return lock(async () => {
    const map = await readMap();
    const removed = map[removedTabId];
    if (!removed) return;
    const merged = [...removed, ...(map[addedTabId] ?? [])];
    map[addedTabId] = [...new Set(merged)].slice(-MAX_TAB_URLS);
    delete map[removedTabId];
    await writeMap(map);
  });
}
