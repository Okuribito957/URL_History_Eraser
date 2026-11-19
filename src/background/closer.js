// T2：清理"最近关闭的标签页"中的受保护条目。
//
// Chrome 只在历史行"真正被删除"时联动清理该列表。受保护 URL 的历史行在浏览时
// 已经删掉了，所以这里先 addUrl 再 deleteUrl，人为制造一次真实删除。

import { MAX_CLOSE_ROUNDS } from '../shared/constants.js';
import { matchUrl } from '../shared/matcher.js';
import { eraseUrl } from './eraser.js';
import { isDeleteBlocked } from './indicator.js';
import { getState } from './state.js';

/** 等待删除生效的超时时间（毫秒） */
const REMOVAL_TIMEOUT_MS = 2000;
/** 标签页关闭时记下的 URL 保留多久（毫秒） */
const PENDING_TTL_MS = 60_000;

let running = false;
let rerunRequested = false;

/** 标签页关闭时记下的受保护 URL → 过期时间 */
const pendingClosedUrls = new Map();

/**
 * 处理后仍留在列表中的 URL（说明此法对它无效），本次 Service Worker 生命周期内不再重试，
 * 防止 sessions.onChanged 与清理互相触发形成死循环
 */
const stuckUrls = new Set();

/**
 * 标签页关闭时调用：记下该标签页访问过的全部受保护 URL。
 * 只处理当前页的话，条目会退回显示上一页，所以要全部处理
 * @param {string[]} urls
 */
export function queueClosedTabUrls(urls) {
  const expiresAt = Date.now() + PENDING_TTL_MS;
  for (const url of urls) pendingClosedUrls.set(url, expiresAt);
}

/**
 * 清理入口。正在执行时只记一个"需要重跑"标记，防止重入
 */
export async function cleanRecentlyClosed() {
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;
  try {
    do {
      rerunRequested = false;
      await runRounds();
    } while (rerunRequested);
  } finally {
    running = false;
  }
}

async function runRounds() {
  const { index, settings } = await getState();
  if (!settings.enabled || !settings.cleanRecentlyClosed || index.size === 0) {
    pendingClosedUrls.clear();
    return;
  }
  // 删除被禁止时 addUrl 会留下真实记录，绝对不能执行
  if (await isDeleteBlocked()) return;

  /** @type {Set<string>} */
  let processed = new Set();
  for (let round = 0; round < MAX_CLOSE_ROUNDS; round++) {
    const found = await findProtectedClosedUrls(index);

    // 上一轮已处理却仍然存在的 URL 视为无法清理
    for (const url of found) {
      if (processed.has(url)) stuckUrls.add(url);
    }
    const targets = new Set([...found].filter((url) => !stuckUrls.has(url)));
    if (targets.size === 0) return; // 没有命中的条目时结束

    // 列表中确实出现了受保护条目，才连同关闭时记下的 URL 一起处理
    if (round === 0) {
      const now = Date.now();
      for (const [url, expiresAt] of pendingClosedUrls) {
        if (expiresAt > now && matchUrl(index, url) && !stuckUrls.has(url)) targets.add(url);
      }
      pendingClosedUrls.clear();
    }

    const ok = await bounceUrls([...targets]);
    if (!ok) return;
    processed = targets;
  }
}

/**
 * 从"最近关闭"列表中找出命中规则的 URL
 * @param {import('../shared/matcher.js').RuleIndex} index
 */
async function findProtectedClosedUrls(index) {
  const sessions = await chrome.sessions.getRecentlyClosed({
    maxResults: chrome.sessions.MAX_SESSION_RESULTS,
  });
  /** @type {Set<string>} */
  const urls = new Set();
  for (const s of sessions) {
    const tabs = s.tab ? [s.tab] : (s.window?.tabs ?? []);
    for (const tab of tabs) {
      if (tab.url && matchUrl(index, tab.url)) urls.add(tab.url);
    }
  }
  return urls;
}

/**
 * 对每个 URL 先添加再删除，并等待删除通知到达
 * @param {string[]} urls
 * @returns {Promise<boolean>} 删除是否可用
 */
async function bounceUrls(urls) {
  const removal = waitForRemoval(urls, REMOVAL_TIMEOUT_MS);
  for (const url of urls) {
    try {
      // 历史行不存在时不会广播删除通知，所以先添加再删除
      await chrome.history.addUrl({ url });
    } catch {
      continue; // 无法添加的 URL 跳过
    }
    if (!(await eraseUrl(url)) && (await isDeleteBlocked())) {
      removal.cancel();
      return false;
    }
  }
  await removal.promise;
  return true;
}

/**
 * 等待 history.onVisitRemoved 通知所有 URL 都已删除（或超时）。
 * 删除通知发出时，Chrome 已同步完成对"最近关闭"列表的联动清理
 * @param {string[]} urls
 * @param {number} timeoutMs
 */
function waitForRemoval(urls, timeoutMs) {
  const remaining = new Set(urls);
  /** @type {() => void} */
  let finish = () => {};
  const promise = new Promise((resolve) => {
    /** @param {chrome.history.RemovedResult} removed */
    const listener = (removed) => {
      if (removed.allHistory) remaining.clear();
      for (const url of removed.urls ?? []) remaining.delete(url);
      if (remaining.size === 0) finish();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    finish = () => {
      clearTimeout(timer);
      chrome.history.onVisitRemoved.removeListener(listener);
      resolve(undefined);
    };
    chrome.history.onVisitRemoved.addListener(listener);
  });
  return { promise, cancel: () => finish() };
}
