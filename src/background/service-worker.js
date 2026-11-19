// 后台入口：在顶层同步注册全部监听器，并负责启动、定时任务和消息处理

import {
  ALARMS,
  FULL_SWEEP_PERIOD_MIN,
  LOCAL_KEYS,
  MESSAGES,
  SESSION_KEYS,
  STARTUP_SWEEP_DELAY_MIN,
} from '../shared/constants.js';
import { matchUrl } from '../shared/matcher.js';
import { createRule, defaultSuffix, parseTarget } from '../shared/rule.js';
import { addRule, ensureDefaults, getMeta, getSettings, removeRule } from '../shared/store.js';
import { cleanRecentlyClosed, queueClosedTabUrls } from './closer.js';
import { attachDownloadListener, sweepDownloads } from './downloads.js';
import { flushReErase, onTabUpdated, onVisited } from './eraser.js';
import { refreshAllTabIcons, refreshBadge, syncBlockedFlag } from './indicator.js';
import { getState, invalidateState } from './state.js';
import { fullSweep, quickSweep, resumeFullSweep, sweepRules } from './sweeper.js';
import { replaceTab, takeTabUrls } from './tab-tracker.js';
import { run } from './util.js';

// ---- 监听器必须在顶层同步注册（Service Worker 随时可能被回收） ----

chrome.history.onVisited.addListener((item) => run(() => onVisited(item), 'onVisited'));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
  run(() => onTabUpdated(tabId, changeInfo, tab), 'onTabUpdated'),
);
chrome.tabs.onRemoved.addListener((tabId) => run(() => onTabRemoved(tabId), 'onTabRemoved'));
chrome.tabs.onReplaced.addListener((added, removed) =>
  run(() => replaceTab(added, removed), 'onTabReplaced'),
);

chrome.sessions.onChanged.addListener(() => run(cleanRecentlyClosed, 'cleanRecentlyClosed'));

chrome.alarms.onAlarm.addListener((alarm) => run(() => onAlarm(alarm), 'onAlarm'));

chrome.runtime.onInstalled.addListener((details) =>
  run(() => onInstalled(details), 'onInstalled'),
);
chrome.runtime.onStartup.addListener(() => run(bootstrap, 'onStartup'));

chrome.storage.onChanged.addListener(onStorageChanged);

chrome.runtime.onMessage.addListener(onMessage);

chrome.commands.onCommand.addListener((command) => run(() => onCommand(command), 'onCommand'));

chrome.permissions.onAdded.addListener(() => attachDownloadListener());
attachDownloadListener();

// 每次 Service Worker 启动都执行
run(bootstrap, 'bootstrap');

// ---- 启动 ----

/**
 * storage.session 在浏览器重启、插件重新启用或重新加载时清空，
 * 用它判断"本次浏览器会话中是否已初始化"
 */
async function bootstrap() {
  const data = await chrome.storage.session.get(SESSION_KEYS.BOOTED);
  if (!data[SESSION_KEYS.BOOTED]) {
    await chrome.storage.session.set({ [SESSION_KEYS.BOOTED]: true });
    await ensureAlarms(false);
    // 延迟清扫：避免抢在 Chrome 恢复上次会话之前清除"上次会话"数据
    await chrome.alarms.create(ALARMS.STARTUP, { delayInMinutes: STARTUP_SWEEP_DELAY_MIN });
    await refreshBadge();
  }
  // 处理上一个 Service Worker 实例中断的工作
  await flushReErase();
  await resumeFullSweep();
}

/**
 * @param {chrome.runtime.InstalledDetails} details
 */
async function onInstalled(details) {
  await ensureDefaults();
  invalidateState();
  await ensureAlarms(true);
  await refreshBadge();
  await refreshAllTabIcons();
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.runtime.openOptionsPage();
  }
}

/**
 * @param {boolean} force  true 时按当前设置重建定时器
 */
async function ensureAlarms(force) {
  const settings = await getSettings();
  const quick = await chrome.alarms.get(ALARMS.QUICK_SWEEP);
  if (force || !quick || quick.periodInMinutes !== settings.quickSweepMinutes) {
    await chrome.alarms.create(ALARMS.QUICK_SWEEP, {
      delayInMinutes: settings.quickSweepMinutes,
      periodInMinutes: settings.quickSweepMinutes,
    });
  }
  const full = await chrome.alarms.get(ALARMS.FULL_SWEEP);
  if (!full) {
    await chrome.alarms.create(ALARMS.FULL_SWEEP, {
      delayInMinutes: FULL_SWEEP_PERIOD_MIN,
      periodInMinutes: FULL_SWEEP_PERIOD_MIN,
    });
  }
}

// ---- 定时任务 ----

/**
 * @param {chrome.alarms.Alarm} alarm
 */
async function onAlarm(alarm) {
  switch (alarm.name) {
    case ALARMS.QUICK_SWEEP:
      await routineSweep();
      break;
    case ALARMS.FULL_SWEEP:
      await fullSweep();
      break;
    case ALARMS.STARTUP: {
      await routineSweep();
      // 距上次全量清扫超过一个周期（包括插件停用期间）时补做一次
      const meta = await getMeta();
      if (Date.now() - meta.lastFullSweepAt > FULL_SWEEP_PERIOD_MIN * 60_000) await fullSweep();
      break;
    }
    default:
      break;
  }
}

/** 快速清扫 + 最近关闭清理 + 下载记录清理 */
async function routineSweep() {
  const count = await quickSweep();
  await cleanRecentlyClosed();
  await sweepDownloads();
  return count;
}

// ---- 标签页关闭 ----

/**
 * @param {number} tabId
 */
async function onTabRemoved(tabId) {
  const urls = await takeTabUrls(tabId);
  if (urls.length === 0) return;
  const { index } = await getState();
  const protectedUrls = urls.filter((url) => matchUrl(index, url));
  if (protectedUrls.length === 0) return;
  queueClosedTabUrls(protectedUrls);
  await cleanRecentlyClosed();
}

// ---- storage 变化 ----

/**
 * @param {Record<string, chrome.storage.StorageChange>} changes
 * @param {string} area
 */
function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  const rules = changes[LOCAL_KEYS.RULES];
  const settings = changes[LOCAL_KEYS.SETTINGS];
  const meta = changes[LOCAL_KEYS.META];

  if (rules || settings) invalidateState();
  if (rules) {
    run(() => onRulesChanged(rules.oldValue ?? [], rules.newValue ?? []), 'onRulesChanged');
  }
  if (settings) {
    run(() => onSettingsChanged(settings.oldValue, settings.newValue ?? {}), 'onSettingsChanged');
  }
  if (meta && meta.oldValue?.deleteBlocked !== meta.newValue?.deleteBlocked) {
    syncBlockedFlag(meta.newValue?.deleteBlocked);
    run(refreshBadge, 'refreshBadge');
  }
}

/**
 * 找出"新生效"的规则：新增、从停用变为启用、或新开启了子域名
 * @param {import('../shared/rule.js').Rule[]} oldRules
 * @param {import('../shared/rule.js').Rule[]} newRules
 */
async function onRulesChanged(oldRules, newRules) {
  await refreshAllTabIcons();

  const oldById = new Map(oldRules.map((r) => [r.id, r]));
  const effective = newRules.filter((r) => {
    if (!r.enabled) return false;
    const old = oldById.get(r.id);
    return !old || !old.enabled || (!old.includeSubdomains && r.includeSubdomains);
  });
  if (effective.length === 0) return;

  const { settings } = await getState();
  if (!settings.enabled || !settings.purgeOnAdd) return;
  await sweepRules(effective.map((r) => r.id));
  await cleanRecentlyClosed();
  await sweepDownloads();
}

/**
 * @param {Partial<import('../shared/store.js').Settings> | undefined} before
 * @param {Partial<import('../shared/store.js').Settings>} after
 */
async function onSettingsChanged(before, after) {
  if (!before) return; // 首次写入默认值
  if (before.quickSweepMinutes !== after.quickSweepMinutes) await ensureAlarms(true);
  if (before.enabled !== after.enabled || before.showIndicator !== after.showIndicator) {
    await refreshBadge();
    await refreshAllTabIcons();
  }
  if (!before.enabled && after.enabled) {
    // 重新开启：清掉关闭期间留下的记录
    await routineSweep();
    await fullSweep();
    return;
  }
  if (!before.cleanRecentlyClosed && after.cleanRecentlyClosed) await cleanRecentlyClosed();
  if (!before.cleanDownloads && after.cleanDownloads) await sweepDownloads();
}

// ---- 消息 ----

/**
 * @param {any} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response: unknown) => void} sendResponse
 */
function onMessage(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id) return false;

  /** @type {(() => Promise<number>) | null} */
  let job = null;
  if (message?.type === MESSAGES.SWEEP_NOW) job = routineSweep;
  if (message?.type === MESSAGES.FULL_SWEEP) {
    job = async () => {
      const count = await fullSweep();
      await cleanRecentlyClosed();
      await sweepDownloads();
      return count;
    };
  }
  if (!job) return false;

  job()
    .then((count) => sendResponse({ ok: true, count }))
    .catch((e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true; // 异步响应
}

// ---- 快捷键 ----

/**
 * 切换当前网站的保护状态
 * @param {string} command
 */
async function onCommand(command) {
  if (command !== 'toggle-current-site') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return;

  const { index } = await getState();
  const matched = matchUrl(index, tab.url);
  if (matched) {
    await removeRule(matched.id);
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const port = url.port ? `:${url.port}` : '';
  const parsed = parseTarget(`${url.protocol}//${defaultSuffix(url.hostname)}${port}`);
  if (parsed.ok) await addRule(createRule(parsed.value));
}
