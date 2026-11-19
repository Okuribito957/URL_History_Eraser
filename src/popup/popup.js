// 弹窗：显示当前网站的保护状态，一键加入 / 移除保护

import { MESSAGES } from '../shared/constants.js';
import { applyI18n, t } from '../shared/i18n.js';
import { buildIndex, matchUrl } from '../shared/matcher.js';
import {
  createRule,
  defaultSuffix,
  describeRule,
  hostSuffixes,
  isIpHost,
  normalizeHostname,
  normalizePath,
  parseTarget,
} from '../shared/rule.js';
import {
  addRule,
  getMeta,
  getRules,
  getSettings,
  removeRule,
  updateRule,
  updateSettings,
} from '../shared/store.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** 当前标签页的 URL（仅 http/https，其余为 null） */
let currentUrl = /** @type {URL | null} */ (null);
/** 当前命中的规则 */
let matchedRule = /** @type {import('../shared/rule.js').Rule | null} */ (null);
/** "移除保护"按钮是否处于待确认状态 */
let removeArmed = false;
let toastTimer = 0;

async function init() {
  applyI18n();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = tab?.url ? new URL(tab.url) : null;
    currentUrl = url && (url.protocol === 'http:' || url.protocol === 'https:') ? url : null;
  } catch {
    currentUrl = null;
  }

  setupAddForm();

  /** @type {HTMLInputElement} */ ($('enabled')).addEventListener('change', (e) => {
    updateSettings({ enabled: /** @type {HTMLInputElement} */ (e.target).checked });
  });
  $('remove-btn').addEventListener('click', onRemove);
  $('add-view').addEventListener('submit', onAdd);
  $('sweep-btn').addEventListener('click', onSweep);
  $('options-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') render();
  });

  await render();
}

/** 初始化"加入保护"表单（只在打开弹窗时执行一次） */
function setupAddForm() {
  if (!currentUrl) return;
  const host = normalizeHostname(currentUrl.hostname);
  const select = /** @type {HTMLSelectElement} */ ($('scope'));
  const preferred = defaultSuffix(host);
  for (const suffix of hostSuffixes(host)) {
    const option = document.createElement('option');
    option.value = suffix;
    option.textContent = suffix;
    option.selected = suffix === preferred;
    select.append(option);
  }

  const includeSub = /** @type {HTMLInputElement} */ ($('include-sub'));
  const pathOnly = /** @type {HTMLInputElement} */ ($('path-only'));
  const path = normalizePath(currentUrl.pathname);

  includeSub.checked = !isIpHost(host);
  includeSub.disabled = isIpHost(host);
  $('path-only-row').hidden = path === '/';
  $('path-only-label').textContent = t('onlyPath', decodeSafe(path));

  // 带路径的规则默认不含子域名
  pathOnly.addEventListener('change', () => {
    if (!includeSub.disabled) includeSub.checked = !pathOnly.checked;
    updatePreview();
  });
  select.addEventListener('change', updatePreview);
  includeSub.addEventListener('change', updatePreview);
  updatePreview();
}

/** 根据表单内容生成规则目标 */
function buildTarget() {
  if (!currentUrl) return null;
  const host = /** @type {HTMLSelectElement} */ ($('scope')).value;
  const port = currentUrl.port ? `:${currentUrl.port}` : '';
  const path = /** @type {HTMLInputElement} */ ($('path-only')).checked
    ? normalizePath(currentUrl.pathname)
    : '';
  const parsed = parseTarget(`${currentUrl.protocol}//${host}${port}${path}`);
  return parsed.ok ? parsed.value : null;
}

function buildRuleFromForm() {
  const target = buildTarget();
  if (!target) return null;
  return createRule(target, {
    includeSubdomains: /** @type {HTMLInputElement} */ ($('include-sub')).checked,
  });
}

function updatePreview() {
  const rule = buildRuleFromForm();
  $('preview').textContent = rule ? t('willProtect', decodeSafe(describeRule(rule))) : '';
}

async function render() {
  const [rules, settings, meta] = await Promise.all([getRules(), getSettings(), getMeta()]);

  /** @type {HTMLInputElement} */ ($('enabled')).checked = settings.enabled;
  $('blocked').hidden = !meta.deleteBlocked;
  $('disabled').hidden = settings.enabled || meta.deleteBlocked;
  $('rule-count').textContent = t('ruleCount', String(rules.length));

  if (!currentUrl) {
    $('site-url').textContent = '—';
    $('status-row').hidden = true;
    $('unsupported').hidden = false;
    $('protected-view').hidden = true;
    $('add-view').hidden = true;
    return;
  }

  const shown = `${currentUrl.host}${currentUrl.pathname === '/' ? '' : currentUrl.pathname}`;
  $('site-url').textContent = decodeSafe(shown);
  $('site-url').title = decodeSafe(shown);

  matchedRule = matchUrl(buildIndex(rules), currentUrl.href);
  const status = $('site-status');
  status.textContent = t(matchedRule ? 'statusProtected' : 'statusUnprotected');
  status.classList.toggle('pill-on', Boolean(matchedRule));

  $('protected-view').hidden = !matchedRule;
  $('add-view').hidden = Boolean(matchedRule);

  if (matchedRule) {
    $('matched-rule').textContent = decodeSafe(describeRule(matchedRule));
    // 命中的是父级域名或路径更宽的规则时，提示移除会影响其他网址
    const isBroader =
      matchedRule.host !== normalizeHostname(currentUrl.hostname) ||
      matchedRule.pathPrefix !== normalizePath(currentUrl.pathname);
    $('parent-hint').hidden = !isBroader;
  }
  resetRemoveButton();
}

/** @param {SubmitEvent} e */
async function onAdd(e) {
  e.preventDefault();
  const rule = buildRuleFromForm();
  if (!rule) return;
  const result = await addRule(rule);
  // 同一规则已存在但被停用时，重新启用
  if (!result.added && !result.rule.enabled) await updateRule(result.rule.id, { enabled: true });
  showToast(t('added'));
}

async function onRemove() {
  if (!matchedRule) return;
  if (!removeArmed) {
    removeArmed = true;
    $('remove-btn').textContent = t('confirmRemove');
    setTimeout(resetRemoveButton, 3000);
    return;
  }
  await removeRule(matchedRule.id);
  showToast(t('removed'));
}

function resetRemoveButton() {
  removeArmed = false;
  $('remove-btn').textContent = t('removeProtection');
}

async function onSweep() {
  const btn = /** @type {HTMLButtonElement} */ ($('sweep-btn'));
  btn.disabled = true;
  btn.textContent = t('sweeping');
  try {
    const res = await chrome.runtime.sendMessage({ type: MESSAGES.SWEEP_NOW });
    showToast(res?.ok ? t('sweepDone', String(res.count ?? 0)) : t('sweepFailed'));
  } catch {
    showToast(t('sweepFailed'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('sweepNow');
  }
}

/** @param {string} text */
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 2000);
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
