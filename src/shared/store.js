// chrome.storage 的读写封装（后台、弹窗、设置页共用）

import { DEFAULT_META, DEFAULT_SETTINGS, LOCAL_KEYS, SCHEMA_VERSION } from './constants.js';
import { ruleKey, sanitizeNote } from './rule.js';

/** @typedef {import('./rule.js').Rule} Rule */
/** @typedef {typeof DEFAULT_SETTINGS} Settings */
/** @typedef {typeof DEFAULT_META} Meta */

/** @returns {Promise<Rule[]>} */
export async function getRules() {
  const data = await chrome.storage.local.get(LOCAL_KEYS.RULES);
  const rules = data[LOCAL_KEYS.RULES];
  return Array.isArray(rules) ? rules : [];
}

/** @param {Rule[]} rules */
export async function saveRules(rules) {
  await chrome.storage.local.set({ [LOCAL_KEYS.RULES]: rules });
}

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const data = await chrome.storage.local.get(LOCAL_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[LOCAL_KEYS.SETTINGS] ?? {}) };
}

/** @param {Partial<Settings>} patch */
export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [LOCAL_KEYS.SETTINGS]: next });
  return next;
}

/** @returns {Promise<Meta>} */
export async function getMeta() {
  const data = await chrome.storage.local.get(LOCAL_KEYS.META);
  return { ...DEFAULT_META, ...(data[LOCAL_KEYS.META] ?? {}) };
}

/** @param {Partial<Meta>} patch */
export async function updateMeta(patch) {
  const current = await getMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [LOCAL_KEYS.META]: next });
  return next;
}

/**
 * 安装 / 更新时补齐默认值，并处理存储结构迁移
 */
export async function ensureDefaults() {
  const data = await chrome.storage.local.get(null);
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (!Array.isArray(data[LOCAL_KEYS.RULES])) patch[LOCAL_KEYS.RULES] = [];
  patch[LOCAL_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS, ...(data[LOCAL_KEYS.SETTINGS] ?? {}) };
  patch[LOCAL_KEYS.META] = {
    ...DEFAULT_META,
    ...(data[LOCAL_KEYS.META] ?? {}),
    schemaVersion: SCHEMA_VERSION,
  };
  await chrome.storage.local.set(patch);
}

/**
 * 新增规则；去重键已存在时不重复添加
 * @param {Rule} rule
 * @returns {Promise<{added: boolean, rule: Rule}>}
 */
export async function addRule(rule) {
  const rules = await getRules();
  const key = ruleKey(rule);
  const existing = rules.find((r) => ruleKey(r) === key);
  if (existing) return { added: false, rule: existing };
  rules.push(rule);
  await saveRules(rules);
  return { added: true, rule };
}

/**
 * 批量合并规则（导入用），返回新增数量
 * @param {Rule[]} incoming
 */
export async function mergeRules(incoming) {
  const rules = await getRules();
  const keys = new Set(rules.map(ruleKey));
  let added = 0;
  for (const rule of incoming) {
    const key = ruleKey(rule);
    if (keys.has(key)) continue;
    keys.add(key);
    rules.push(rule);
    added++;
  }
  if (added > 0) await saveRules(rules);
  return added;
}

/**
 * 更新规则的可编辑字段
 * @param {string} id
 * @param {Partial<Pick<Rule, 'enabled' | 'includeSubdomains' | 'note'>>} patch
 */
export async function updateRule(id, patch) {
  const rules = await getRules();
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;
  if (typeof patch.enabled === 'boolean') rule.enabled = patch.enabled;
  if (typeof patch.includeSubdomains === 'boolean') rule.includeSubdomains = patch.includeSubdomains;
  if (patch.note !== undefined) rule.note = sanitizeNote(patch.note);
  await saveRules(rules);
}

/** @param {string} id */
export async function removeRule(id) {
  const rules = await getRules();
  await saveRules(rules.filter((r) => r.id !== id));
}

/**
 * 简单的串行锁，用于包裹 storage 的"读-改-写"，避免并发事件互相覆盖
 */
export function createMutex() {
  let tail = Promise.resolve();
  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  return function lock(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => undefined);
    return result;
  };
}
