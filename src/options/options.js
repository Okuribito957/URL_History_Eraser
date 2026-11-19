// 设置页：规则管理、清扫、选项、同步引导、导入导出

import { MESSAGES, QUICK_SWEEP_CHOICES, SYNC_SETTINGS_URL } from '../shared/constants.js';
import { applyI18n, formatTime, t } from '../shared/i18n.js';
import { buildIndex, matchUrl } from '../shared/matcher.js';
import {
  createRule,
  defaultIncludeSubdomains,
  describeRule,
  isIpHost,
  parseTarget,
  ruleOpenUrl,
  sanitizeImportedRule,
} from '../shared/rule.js';
import {
  addRule,
  getMeta,
  getRules,
  getSettings,
  mergeRules,
  removeRule,
  updateRule,
  updateSettings,
} from '../shared/store.js';

/** @typedef {import('../shared/rule.js').Rule} Rule */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** 复选框 id 后缀 → 设置键 */
const BOOL_OPTIONS = /** @type {const} */ ([
  'purgeOnAdd',
  'cleanRecentlyClosed',
  'cleanDownloads',
  'showIndicator',
]);

/** @type {Rule[]} */
let rules = [];
/** 用户是否手动改过"包含子域名"，改过就不再自动设置 */
let subTouched = false;
/** 正在编辑备注时推迟表格重绘，避免输入框失去焦点 */
let tableDirty = false;
let toastTimer = 0;

async function init() {
  applyI18n();
  setupIntervalSelect();
  bindEvents();
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') render();
  });
  await render();
}

function setupIntervalSelect() {
  const select = /** @type {HTMLSelectElement} */ ($('opt-quickSweepMinutes'));
  for (const n of QUICK_SWEEP_CHOICES) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = t('minutes', String(n));
    select.append(option);
  }
}

function bindEvents() {
  input('enabled').addEventListener('change', (e) => {
    updateSettings({ enabled: /** @type {HTMLInputElement} */ (e.target).checked });
  });

  // 新增规则
  input('rule-input').addEventListener('input', updateAddPreview);
  input('include-sub').addEventListener('change', () => {
    subTouched = true;
    updateAddPreview();
  });
  $('add-form').addEventListener('submit', onAddRule);

  // 规则表格（事件委托）
  input('filter').addEventListener('input', renderRules);
  const body = $('rules-body');
  body.addEventListener('change', onTableChange);
  body.addEventListener('click', onTableClick);
  body.addEventListener('focusout', () => {
    if (tableDirty) setTimeout(renderRules, 0);
  });

  // 清扫
  $('quick-btn').addEventListener('click', () => runSweep(MESSAGES.SWEEP_NOW));
  $('full-btn').addEventListener('click', () => runSweep(MESSAGES.FULL_SWEEP));

  // 选项
  for (const key of BOOL_OPTIONS) {
    input(`opt-${key}`).addEventListener('change', (e) => onBoolOption(key, /** @type {HTMLInputElement} */ (e.target)));
  }
  $('opt-quickSweepMinutes').addEventListener('change', (e) => {
    const value = Number(/** @type {HTMLSelectElement} */ (e.target).value);
    updateSettings({ quickSweepMinutes: value }).then(() => showToast(t('saved')));
  });

  // 同步
  $('sync-btn').addEventListener('click', () => chrome.tabs.create({ url: SYNC_SETTINGS_URL }));

  // 导入导出
  $('export-btn').addEventListener('click', exportRules);
  $('import-btn').addEventListener('click', () => input('import-file').click());
  input('import-file').addEventListener('change', importRules);
}

// ---- 渲染 ----

async function render() {
  const [loadedRules, settings, meta, hasDownloads] = await Promise.all([
    getRules(),
    getSettings(),
    getMeta(),
    chrome.permissions.contains({ permissions: ['downloads'] }),
  ]);
  rules = loadedRules;

  input('enabled').checked = settings.enabled;
  $('blocked').hidden = !meta.deleteBlocked;
  $('disabled').hidden = settings.enabled || meta.deleteBlocked;

  for (const key of BOOL_OPTIONS) {
    input(`opt-${key}`).checked = key === 'cleanDownloads' ? settings[key] && hasDownloads : settings[key];
  }
  /** @type {HTMLSelectElement} */ ($('opt-quickSweepMinutes')).value = String(settings.quickSweepMinutes);

  $('last-quick').textContent = formatTime(meta.lastQuickSweepAt);
  $('last-full').textContent = formatTime(meta.lastFullSweepAt);

  renderRules();
}

function renderRules() {
  const body = $('rules-body');
  // 正在编辑备注时推迟重绘
  if (body.contains(document.activeElement) && document.activeElement?.classList.contains('note-input')) {
    tableDirty = true;
    return;
  }
  tableDirty = false;

  const query = input('filter').value.trim().toLowerCase();
  const sorted = [...rules].sort((a, b) =>
    `${a.host}${a.pathPrefix}`.localeCompare(`${b.host}${b.pathPrefix}`),
  );
  const shown = query
    ? sorted.filter((r) => `${describeRule(r)} ${r.note ?? ''}`.toLowerCase().includes(query))
    : sorted;

  body.replaceChildren(...shown.map(renderRow));
  $('rule-count').textContent = t('ruleCount', String(rules.length));

  const empty = $('rules-empty');
  empty.hidden = shown.length > 0;
  empty.textContent = rules.length === 0 ? t('noRules') : t('noMatchRules');
}

/**
 * @param {Rule} rule
 */
function renderRow(rule) {
  const tr = document.createElement('tr');
  tr.dataset.id = rule.id;
  tr.classList.toggle('disabled', !rule.enabled);

  const ruleCell = document.createElement('td');
  ruleCell.className = 'rule-cell mono';
  ruleCell.textContent = decodeSafe(describeRule(rule));

  const subCell = document.createElement('td');
  subCell.className = 'center';
  const sub = checkbox('includeSubdomains', rule.includeSubdomains);
  sub.disabled = isIpHost(rule.host);
  subCell.append(sub);

  const enabledCell = document.createElement('td');
  enabledCell.className = 'center';
  enabledCell.append(checkbox('enabled', rule.enabled));

  const noteCell = document.createElement('td');
  const note = document.createElement('input');
  note.type = 'text';
  note.className = 'note-input';
  note.value = rule.note ?? '';
  note.dataset.field = 'note';
  noteCell.append(note);

  const actionCell = document.createElement('td');
  actionCell.className = 'right';
  actionCell.append(button('open', t('open'), 'btn btn-link'), button('delete', t('delete'), 'btn btn-link danger'));

  tr.append(ruleCell, subCell, enabledCell, noteCell, actionCell);
  return tr;
}

/**
 * @param {string} field
 * @param {boolean} checked
 */
function checkbox(field, checked) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = checked;
  el.dataset.field = field;
  return el;
}

/**
 * @param {string} action
 * @param {string} text
 * @param {string} className
 */
function button(action, text, className) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  el.dataset.action = action;
  return el;
}

// ---- 新增规则 ----

function updateAddPreview() {
  const raw = input('rule-input').value;
  const includeSub = input('include-sub');
  const errorEl = $('add-error');
  const previewEl = $('add-preview');

  if (!raw.trim()) {
    subTouched = false;
    includeSub.disabled = false;
    errorEl.hidden = true;
    previewEl.hidden = true;
    return;
  }

  const parsed = parseTarget(raw);
  if (!parsed.ok) {
    errorEl.textContent = t(parsed.error);
    errorEl.hidden = false;
    previewEl.hidden = true;
    return;
  }

  const target = parsed.value;
  includeSub.disabled = target.isIp;
  if (target.isIp) includeSub.checked = false;
  else if (!subTouched) includeSub.checked = defaultIncludeSubdomains(target);

  const rule = createRule(target, { includeSubdomains: includeSub.checked });
  const { hits, misses } = examples(rule);
  $('preview-rule').textContent = decodeSafe(describeRule(rule));
  $('preview-hits').textContent = hits.join('   ·   ') || '—';
  $('preview-misses').textContent = misses.join('   ·   ') || '—';
  errorEl.hidden = true;
  previewEl.hidden = false;
}

/**
 * 生成"会命中 / 不会命中"的示例，用匹配器实际判定，保证与真实行为一致
 * @param {Rule} rule
 */
function examples(rule) {
  const index = buildIndex([rule]);
  const port = rule.port ? `:${rule.port}` : '';
  const base = rule.pathPrefix === '/' ? '' : rule.pathPrefix;
  const ip = isIpHost(rule.host);

  const candidates = [
    `https://${rule.host}${port}${base || '/'}`,
    `https://${rule.host}${port}${base}/page?q=1`,
  ];
  if (!ip) candidates.push(`https://www.${rule.host}${port}${base || '/'}`);
  if (base) candidates.push(`https://${rule.host}${port}${base}x`);
  if (!ip) candidates.push(`https://not${rule.host}${port}/`);
  if (rule.port) candidates.push(`https://${rule.host}/`);

  const hits = [];
  const misses = [];
  for (const url of candidates) {
    const label = decodeSafe(url.replace(/^https:\/\//, ''));
    (matchUrl(index, url) ? hits : misses).push(label);
  }
  return { hits, misses };
}

/** @param {SubmitEvent} e */
async function onAddRule(e) {
  e.preventDefault();
  const parsed = parseTarget(input('rule-input').value);
  if (!parsed.ok) {
    $('add-error').textContent = t(parsed.error);
    $('add-error').hidden = false;
    return;
  }
  const rule = createRule(parsed.value, {
    includeSubdomains: input('include-sub').checked,
    note: input('note-input').value,
  });
  const result = await addRule(rule);
  if (!result.added) {
    $('add-error').textContent = t('ruleExists');
    $('add-error').hidden = false;
    return;
  }
  input('rule-input').value = '';
  input('note-input').value = '';
  input('include-sub').checked = true;
  updateAddPreview();
  showToast(t('ruleAdded'));
}

// ---- 表格操作 ----

/** @param {Event} e */
async function onTableChange(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const id = el.closest('tr')?.dataset.id;
  const field = el.dataset.field;
  if (!id || !field) return;

  if (field === 'note') {
    await updateRule(id, { note: el.value });
    showToast(t('saved'));
  } else if (field === 'enabled' || field === 'includeSubdomains') {
    await updateRule(id, { [field]: el.checked });
  }
}

/** @param {MouseEvent} e */
async function onTableClick(e) {
  const el = /** @type {HTMLElement} */ (e.target);
  const action = el.dataset?.action;
  const id = el.closest('tr')?.dataset.id;
  const rule = rules.find((r) => r.id === id);
  if (!action || !rule) return;

  if (action === 'open') {
    await chrome.tabs.create({ url: ruleOpenUrl(rule) });
  } else if (action === 'delete') {
    if (!window.confirm(t('confirmDeleteRule', decodeSafe(describeRule(rule))))) return;
    await removeRule(rule.id);
    showToast(t('ruleDeleted'));
  }
}

// ---- 清扫 ----

/** @param {string} type */
async function runSweep(type) {
  const buttons = [/** @type {HTMLButtonElement} */ ($('quick-btn')), /** @type {HTMLButtonElement} */ ($('full-btn'))];
  const status = $('sweep-status');
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = t('sweeping');
  try {
    const res = await chrome.runtime.sendMessage({ type });
    status.textContent = res?.ok ? t('sweepDone', String(res.count ?? 0)) : t('sweepFailed');
  } catch {
    status.textContent = t('sweepFailed');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---- 选项 ----

/**
 * @param {typeof BOOL_OPTIONS[number]} key
 * @param {HTMLInputElement} el
 */
async function onBoolOption(key, el) {
  if (key === 'cleanDownloads' && el.checked) {
    // 必须在用户操作的事件中请求权限
    const granted = await chrome.permissions.request({ permissions: ['downloads'] });
    if (!granted) {
      el.checked = false;
      showToast(t('permissionDenied'));
      return;
    }
  }
  await updateSettings({ [key]: el.checked });
  showToast(t('saved'));
}

// ---- 导入导出 ----

function exportRules() {
  const data = {
    app: 'url-history-eraser',
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: rules.map(({ host, port, pathPrefix, includeSubdomains, enabled, note }) => ({
      host,
      port,
      pathPrefix,
      includeSubdomains,
      enabled,
      note: note ?? '',
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  a.href = url;
  a.download = `url-history-eraser-rules-${date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {Event} e */
async function importRules(e) {
  const fileInput = /** @type {HTMLInputElement} */ (e.target);
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data?.rules;
    if (!Array.isArray(list)) throw new Error('invalid format');
    const valid = list.map(sanitizeImportedRule).filter((r) => r !== null);
    const added = await mergeRules(/** @type {Rule[]} */ (valid));
    showToast(t('importDone', String(added)));
  } catch {
    showToast(t('importFailed'));
  }
}

// ---- 工具 ----

/** @param {string} text */
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

/**
 * 显示用：把百分号编码还原为可读文字
 * @param {string} text
 */
function decodeSafe(text) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

init();
