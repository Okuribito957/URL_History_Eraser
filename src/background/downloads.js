// 下载记录清理（可选功能，需要用户授予 downloads 可选权限）。
// 只从下载列表中移除记录，不删除已下载的文件

import { matchUrl } from '../shared/matcher.js';
import { getState } from './state.js';
import { run } from './util.js';

let attached = false;

/**
 * 注册下载监听器。权限未授予时 chrome.downloads 不存在，直接返回。
 * 启动时在顶层同步调用一次，权限新授予时再调用一次
 */
export function attachDownloadListener() {
  if (attached || !chrome.downloads) return;
  chrome.downloads.onChanged.addListener((delta) => {
    run(() => onDownloadChanged(delta), 'onDownloadChanged');
  });
  attached = true;
}

/**
 * @param {chrome.downloads.DownloadDelta} delta
 */
async function onDownloadChanged(delta) {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;
  const { index, settings } = await getState();
  if (!settings.enabled || !settings.cleanDownloads || index.size === 0) return;

  const [item] = await chrome.downloads.search({ id: delta.id });
  if (item && isProtected(index, item)) await chrome.downloads.erase({ id: item.id });
}

/**
 * 清扫下载列表中已结束的受保护记录
 * @returns {Promise<number>}
 */
export async function sweepDownloads() {
  if (!chrome.downloads) return 0;
  const { index, settings } = await getState();
  if (!settings.enabled || !settings.cleanDownloads || index.size === 0) return 0;

  const items = await chrome.downloads.search({ limit: 0 });
  let count = 0;
  for (const item of items) {
    if (item.state === 'in_progress') continue;
    if (!isProtected(index, item)) continue;
    await chrome.downloads.erase({ id: item.id });
    count++;
  }
  return count;
}

/**
 * 下载地址、最终地址或来源页命中规则即视为受保护
 * @param {import('../shared/matcher.js').RuleIndex} index
 * @param {chrome.downloads.DownloadItem} item
 */
function isProtected(index, item) {
  return [item.url, item.finalUrl, item.referrer].some((u) => u && matchUrl(index, u));
}
