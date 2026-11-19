// 规则的解析、规范化与校验（纯函数，不依赖 chrome.*，可在 Node 中测试）

/**
 * @typedef {Object} Rule
 * @property {string}  id                 唯一 ID（crypto.randomUUID）
 * @property {string}  host               规范化后的主机名（小写、punycode）
 * @property {string}  port               端口。空字符串表示"任意端口"
 * @property {string}  pathPrefix         路径前缀。"/" 表示"任意路径"
 * @property {boolean} includeSubdomains  是否包含子域名
 * @property {boolean} enabled            是否启用
 * @property {number}  createdAt          创建时间（毫秒）
 * @property {string}  [note]             备注
 */

/**
 * @typedef {Object} ParsedTarget
 * @property {string} host
 * @property {string} port
 * @property {string} pathPrefix
 * @property {boolean} isIp  主机名是否为 IP 地址
 */

/**
 * @typedef {{ok: true, value: ParsedTarget} | {ok: false, error: string}} ParseResult
 * error 为 i18n 消息键
 */

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAX_NOTE_LENGTH = 200;

/**
 * 判断主机名是否为 IP 地址（IPv4 或带方括号的 IPv6）
 * @param {string} hostname
 */
export function isIpHost(hostname) {
  return hostname.startsWith('[') || IPV4_RE.test(hostname);
}

/**
 * 把用户输入（域名或完整网址）解析为规则目标
 * @param {string} input
 * @returns {ParseResult}
 */
export function parseTarget(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'errEmpty' };
  if (/\s/.test(raw)) return { ok: false, error: 'errInvalid' };

  // 带协议时只接受 http / https；"example.com:8080" 这种形式不算协议
  const scheme = SCHEME_RE.exec(raw);
  let text = raw;
  let hadScheme = false;
  if (scheme && !/^\d+$/.test(raw.slice(scheme[0].length).split(/[/?#]/)[0])) {
    const proto = scheme[1].toLowerCase();
    if (proto !== 'http' && proto !== 'https') return { ok: false, error: 'errScheme' };
    hadScheme = true;
  } else {
    text = `https://${raw}`;
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'errInvalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'errScheme' };
  }

  const host = normalizeHostname(url.hostname);
  if (!host) return { ok: false, error: 'errInvalid' };
  const isIp = isIpHost(host);
  // 防止误输入：没有点的单标签主机名只在 localhost 或显式写了协议时接受（如 http://intranet）
  if (!isIp && !host.includes('.') && host !== 'localhost' && !hadScheme) {
    return { ok: false, error: 'errInvalid' };
  }

  return {
    ok: true,
    value: {
      host,
      port: url.port,
      pathPrefix: normalizePath(url.pathname),
      isIp,
    },
  };
}

/**
 * 主机名规范化：小写、去掉末尾的点
 * @param {string} hostname
 */
export function normalizeHostname(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/\.+$/, '');
}

/**
 * 路径规范化：去掉末尾的 "/"，根路径保留为 "/"
 * @param {string} pathname
 */
export function normalizePath(pathname) {
  let p = String(pathname || '/');
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || '/';
}

/**
 * 默认是否包含子域名：纯域名规则默认包含，带路径的规则或 IP 默认不包含
 * @param {ParsedTarget} target
 */
export function defaultIncludeSubdomains(target) {
  return !target.isIp && target.pathPrefix === '/';
}

/**
 * 根据解析结果创建规则
 * @param {ParsedTarget} target
 * @param {{includeSubdomains?: boolean, note?: string, enabled?: boolean}} [options]
 * @returns {Rule}
 */
export function createRule(target, options = {}) {
  const include = target.isIp
    ? false
    : (options.includeSubdomains ?? defaultIncludeSubdomains(target));
  return {
    id: newId(),
    host: target.host,
    port: target.port,
    pathPrefix: target.pathPrefix,
    includeSubdomains: include,
    enabled: options.enabled ?? true,
    createdAt: Date.now(),
    note: sanitizeNote(options.note),
  };
}

/**
 * 去重键
 * @param {Pick<Rule, 'host' | 'port' | 'pathPrefix'>} rule
 */
export function ruleKey(rule) {
  return `${rule.host}|${rule.port}|${rule.pathPrefix}`;
}

/**
 * 规则的展示文本，如 "*.example.com:8080/foo"
 * @param {Rule} rule
 */
export function describeRule(rule) {
  const prefix = rule.includeSubdomains ? '*.' : '';
  const port = rule.port ? `:${rule.port}` : '';
  const path = rule.pathPrefix === '/' ? '' : rule.pathPrefix;
  return `${prefix}${rule.host}${port}${path}`;
}

/**
 * 打开规则对应网址时使用的 URL
 * @param {Rule} rule
 */
export function ruleOpenUrl(rule) {
  const port = rule.port ? `:${rule.port}` : '';
  return `https://${rule.host}${port}${rule.pathPrefix}`;
}

/**
 * 校验并清洗导入的规则对象，非法时返回 null
 * @param {unknown} obj
 * @returns {Rule | null}
 */
export function sanitizeImportedRule(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (obj);
  // 主机名里不允许出现会改变 URL 结构的字符
  if (typeof o.host !== 'string' || !o.host || /[\s/?#@\\]/.test(o.host)) return null;

  // 重新走一遍解析，保证与手动输入的规范化结果一致
  const port = typeof o.port === 'string' && /^\d{0,5}$/.test(o.port) ? o.port : '';
  const path = typeof o.pathPrefix === 'string' ? o.pathPrefix : '/';
  const parsed = parseTarget(`https://${o.host}${port ? `:${port}` : ''}${path}`);
  if (!parsed.ok) return null;

  return createRule(parsed.value, {
    includeSubdomains: typeof o.includeSubdomains === 'boolean' ? o.includeSubdomains : undefined,
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    note: typeof o.note === 'string' ? o.note : '',
  });
}

/**
 * 列出主机名的各级后缀（至少两级），供弹窗选择保护范围
 * 例：a.b.example.com → [a.b.example.com, b.example.com, example.com]
 * @param {string} hostname
 * @returns {string[]}
 */
export function hostSuffixes(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return [];
  if (isIpHost(host) || !host.includes('.')) return [host];
  const labels = host.split('.');
  const result = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    result.push(labels.slice(i).join('.'));
  }
  return result;
}

/**
 * 弹窗中默认选中的保护范围：去掉开头的 "www."
 * @param {string} hostname
 */
export function defaultSuffix(hostname) {
  const host = normalizeHostname(hostname);
  const stripped = host.startsWith('www.') ? host.slice(4) : host;
  return stripped.includes('.') || isIpHost(stripped) ? stripped : host;
}

/**
 * @param {unknown} note
 */
export function sanitizeNote(note) {
  return typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_LENGTH) : '';
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
