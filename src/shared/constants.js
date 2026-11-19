// 全局常量

/** 当前存储结构版本，结构变化时递增并在安装 / 更新时迁移 */
export const SCHEMA_VERSION = 1;

/** chrome.storage.local 中的键 */
export const LOCAL_KEYS = Object.freeze({
  RULES: 'rules',
  SETTINGS: 'settings',
  META: 'meta',
});

/** chrome.storage.session 中的键（仅内存，浏览器退出即清空） */
export const SESSION_KEYS = Object.freeze({
  BOOTED: 'booted',
  TAB_URLS: 'tabUrls',
  PENDING_RE_ERASE: 'pendingReErase',
  FULL_SWEEP_CURSOR: 'fullSweepCursor',
});

/** 默认设置 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  purgeOnAdd: true,
  cleanRecentlyClosed: true,
  cleanDownloads: false,
  quickSweepMinutes: 15,
  showIndicator: true,
});

/** 默认元数据（只存时间戳和布尔值，绝不存 URL） */
export const DEFAULT_META = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  lastQuickSweepAt: 0,
  lastFullSweepAt: 0,
  deleteBlocked: false,
});

/** 快速清扫间隔的可选值（分钟） */
export const QUICK_SWEEP_CHOICES = Object.freeze([5, 15, 30, 60]);

/** 定时器名称 */
export const ALARMS = Object.freeze({
  QUICK_SWEEP: 'uhe-quick-sweep',
  FULL_SWEEP: 'uhe-full-sweep',
  STARTUP: 'uhe-startup',
});

/** 全量清扫的周期（分钟） */
export const FULL_SWEEP_PERIOD_MIN = 24 * 60;

/** 浏览器启动后延迟多久再清扫（分钟）。避免抢在会话恢复之前清除"上次会话"数据 */
export const STARTUP_SWEEP_DELAY_MIN = 1;

/** 补删的延迟（毫秒），用于清掉 favicon 等延迟写入 */
export const RE_ERASE_DELAY_MS = 2000;

/** 每个标签页最多记录的受保护 URL 数 */
export const MAX_TAB_URLS = 200;

/** "最近关闭"清理的最大轮数 */
export const MAX_CLOSE_ROUNDS = 20;

/** history.search 单次返回上限 */
export const SEARCH_PAGE_SIZE = 1000;

/** 快速清扫对单条规则的最大重复次数 */
export const MAX_QUICK_SWEEP_LOOPS = 20;

/** 后台与页面之间的消息类型 */
export const MESSAGES = Object.freeze({
  SWEEP_NOW: 'uhe/sweep-now',
  FULL_SWEEP: 'uhe/full-sweep',
});

/** 同步高级设置页 */
export const SYNC_SETTINGS_URL = 'chrome://settings/syncSetup/advanced';
