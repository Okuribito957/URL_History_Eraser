// 后台通用工具

/**
 * 执行异步处理并吞掉异常，避免未捕获的 Promise 拒绝。
 * 日志中只输出错误信息，不输出任何 URL。
 * @param {() => Promise<unknown>} fn
 * @param {string} [label]
 */
export function run(fn, label = 'task') {
  return Promise.resolve()
    .then(fn)
    .catch((e) => {
      console.warn(`[UHE] ${label} failed:`, e?.message ?? String(e));
    });
}

/**
 * 等待指定毫秒
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
