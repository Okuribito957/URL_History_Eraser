// T3：残留清扫
// - 快速清扫：按规则的主机名做文本检索，删除命中项
// - 全量清扫：按时间窗口遍历全部历史，窗口内结果过多时二分，进度存入 storage.session 以便续跑

import {
  MAX_QUICK_SWEEP_LOOPS,
  SEARCH_PAGE_SIZE,
  SESSION_KEYS,
} from '../shared/constants.js';
import { buildIndex, matchUrl } from '../shared/matcher.js';
import { createMutex, updateMeta } from '../shared/store.js';
import { eraseUrl } from './eraser.js';
import { isDeleteBlocked } from './indicator.js';
import { getState } from './state.js';

/** 时间窗口小于此值（毫秒）时不再二分 */
const MIN_WINDOW_MS = 1000;

/** 所有清扫串行执行 */
const sweepLock = createMutex();

/**
 * @typedef {Object} SweepCursor
 * @property {string[] | null} ruleIds  null 表示针对全部规则
 * @property {Array<[number, number]>} stack  待处理的时间窗口
 */

/**
 * 快速清扫
 * @param {string[] | null} [ruleIds]  只清扫指定规则；省略时针对全部规则
 * @returns {Promise<number>} 删除的条数
 */
export function quickSweep(ruleIds = null) {
  return sweepLock(() => doQuickSweep(ruleIds));
}

/**
 * 全量清扫
 * @param {string[] | null} [ruleIds]  只清扫指定规则；省略时针对全部规则
 * @returns {Promise<number>} 删除的条数
 */
export function fullSweep(ruleIds = null) {
  return sweepLock(() => doFullSweep(ruleIds, null));
}

/**
 * 新增规则后清除既有记录：先快速清扫给出即时效果，再全量清扫兜底
 * @param {string[]} ruleIds
 */
export async function sweepRules(ruleIds) {
  const quick = await quickSweep(ruleIds);
  const full = await fullSweep(ruleIds);
  return quick + full;
}

/**
 * Service Worker 重启后继续未完成的全量清扫
 */
export async function resumeFullSweep() {
  const data = await chrome.storage.session.get(SESSION_KEYS.FULL_SWEEP_CURSOR);
  /** @type {SweepCursor | undefined} */
  const cursor = data[SESSION_KEYS.FULL_SWEEP_CURSOR];
  if (!cursor || !Array.isArray(cursor.stack)) return 0;
  return sweepLock(() => doFullSweep(cursor.ruleIds, cursor.stack));
}

/**
 * @param {string[] | null} ruleIds
 */
async function scopedIndex(ruleIds) {
  const { rules, settings } = await getState();
  if (!settings.enabled) return null;
  const scoped = ruleIds ? rules.filter((r) => ruleIds.includes(r.id)) : rules;
  const index = buildIndex(scoped);
  return index.size > 0 ? { index, rules: scoped.filter((r) => r.enabled) } : null;
}

/**
 * 删除命中的条目
 * @param {chrome.history.HistoryItem[]} items
 * @param {import('../shared/matcher.js').RuleIndex} index
 * @returns {Promise<{deleted: number, blocked: boolean}>}
 */
async function eraseMatches(items, index) {
  let deleted = 0;
  for (const item of items) {
    if (!item.url || !matchUrl(index, item.url)) continue;
    if (await eraseUrl(item.url)) {
      deleted++;
    } else if (await isDeleteBlocked()) {
      return { deleted, blocked: true };
    }
  }
  return { deleted, blocked: false };
}

/**
 * @param {string[] | null} ruleIds
 */
async function doQuickSweep(ruleIds) {
  const scope = await scopedIndex(ruleIds);
  if (!scope) return 0;

  let total = 0;
  const hosts = new Set(scope.rules.map((r) => r.host));
  for (const host of hosts) {
    for (let i = 0; i < MAX_QUICK_SWEEP_LOOPS; i++) {
      // startTime 默认只查最近 24 小时，必须显式传 0
      const items = await chrome.history.search({
        text: host,
        startTime: 0,
        maxResults: SEARCH_PAGE_SIZE,
      });
      const { deleted, blocked } = await eraseMatches(items, scope.index);
      total += deleted;
      if (blocked) return total;
      // 没有命中，或结果未满一页（命中项已全部删除）时结束
      if (deleted === 0 || items.length < SEARCH_PAGE_SIZE) break;
    }
  }
  if (!ruleIds) await updateMeta({ lastQuickSweepAt: Date.now() });
  return total;
}

/**
 * @param {string[] | null} ruleIds
 * @param {Array<[number, number]> | null} resumeStack
 */
async function doFullSweep(ruleIds, resumeStack) {
  const scope = await scopedIndex(ruleIds);
  if (!scope) {
    await saveCursor(null);
    return 0;
  }

  /** @type {Array<[number, number]>} */
  const stack = resumeStack ?? [[0, Date.now() + 60_000]];
  let total = 0;

  while (stack.length > 0) {
    const [start, end] = /** @type {[number, number]} */ (stack.pop());
    const items = await chrome.history.search({
      text: '',
      startTime: start,
      endTime: end,
      maxResults: SEARCH_PAGE_SIZE,
    });

    if (items.length >= SEARCH_PAGE_SIZE && end - start > MIN_WINDOW_MS) {
      // 结果可能被截断，二分窗口；新的一半后入栈，先处理
      const mid = Math.floor((start + end) / 2);
      stack.push([start, mid], [mid, end]);
    } else {
      const { deleted, blocked } = await eraseMatches(items, scope.index);
      total += deleted;
      if (blocked) {
        await saveCursor(null);
        return total;
      }
    }
    await saveCursor(stack.length ? { ruleIds, stack } : null);
  }

  if (!ruleIds) await updateMeta({ lastFullSweepAt: Date.now() });
  return total;
}

/**
 * @param {SweepCursor | null} cursor
 */
async function saveCursor(cursor) {
  if (cursor) {
    await chrome.storage.session.set({ [SESSION_KEYS.FULL_SWEEP_CURSOR]: cursor });
  } else {
    await chrome.storage.session.remove(SESSION_KEYS.FULL_SWEEP_CURSOR);
  }
}
