// 规则索引与 URL 匹配（纯函数，不依赖 chrome.*，可在 Node 中测试）

import { isIpHost, normalizeHostname } from './rule.js';

/** @typedef {import('./rule.js').Rule} Rule */
/** @typedef {Map<string, Rule[]>} RuleIndex */

/**
 * 按主机名把启用中的规则索引到 Map 中
 * @param {Rule[]} rules
 * @returns {RuleIndex}
 */
export function buildIndex(rules) {
  /** @type {RuleIndex} */
  const index = new Map();
  for (const rule of rules ?? []) {
    if (!rule || !rule.enabled) continue;
    const list = index.get(rule.host) ?? [];
    list.push(rule);
    index.set(rule.host, list);
  }
  return index;
}

/**
 * URL 受保护时返回命中的规则，否则返回 null
 * @param {RuleIndex} index
 * @param {string} rawUrl
 * @returns {Rule | null}
 */
export function matchUrl(index, rawUrl) {
  if (!index || index.size === 0 || !rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null; // 无法解析的 URL 不处理
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) return null;

  // IP 地址没有"子域名"的概念，只做精确匹配
  const candidates = isIpHost(hostname) ? [hostname] : suffixesOf(hostname);

  for (let i = 0; i < candidates.length; i++) {
    for (const rule of index.get(candidates[i]) ?? []) {
      // 父级域名的规则只有在 includeSubdomains 开启时才适用
      if (i > 0 && !rule.includeSubdomains) continue;
      if (rule.port && rule.port !== url.port) continue;
      if (pathMatches(url.pathname, rule.pathPrefix)) return rule;
    }
  }
  return null;
}

/**
 * 路径按段边界做前缀匹配（/foo 不命中 /foobar）
 * @param {string} pathname
 * @param {string} prefix
 */
export function pathMatches(pathname, prefix) {
  if (prefix === '/') return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 主机名从自身开始逐级去掉最左侧标签
 * @param {string} hostname
 */
function suffixesOf(hostname) {
  const labels = hostname.split('.');
  const result = [];
  for (let i = 0; i < labels.length; i++) {
    result.push(labels.slice(i).join('.'));
  }
  return result;
}
