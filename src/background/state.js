// 规则与设置的惰性缓存。Service Worker 每次被唤醒后首次使用时从 storage 读取，
// storage 变化时由 service-worker.js 调用 invalidateState() 失效

import { buildIndex } from '../shared/matcher.js';
import { getRules, getSettings } from '../shared/store.js';

/**
 * @typedef {Object} State
 * @property {import('../shared/rule.js').Rule[]} rules
 * @property {import('../shared/store.js').Settings} settings
 * @property {import('../shared/matcher.js').RuleIndex} index
 */

/** @type {Promise<State> | null} */
let cache = null;

/** @returns {Promise<State>} */
export function getState() {
  if (!cache) {
    const loading = (async () => {
      const [rules, settings] = await Promise.all([getRules(), getSettings()]);
      return { rules, settings, index: buildIndex(rules) };
    })();
    // 读取失败时不缓存，下次重试
    loading.catch(() => {
      if (cache === loading) cache = null;
    });
    cache = loading;
  }
  return cache;
}

export function invalidateState() {
  cache = null;
}
