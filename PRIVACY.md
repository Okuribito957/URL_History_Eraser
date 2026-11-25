# Privacy Policy — URL History Eraser

Last updated: November 25, 2026

[English](#english) | [中文](#中文)

## English

URL History Eraser does not collect, transmit, sell, or share any personal information. Everything the extension does happens locally in your browser, and it makes no network requests.

### What the extension accesses, and why

The extension removes browsing traces for the sites you choose. To do that it needs to read some browser data on your device:

| Data | Permission | How it is used |
|---|---|---|
| Browsing history | `history` | Finds history entries that match your rules and deletes them. While cleaning the "recently closed" list, it may re-add a matching address for an instant and delete it again, because that is the only way the browser removes the entry. |
| Addresses of open tabs | `tabs` | Checks whether the page in a tab matches one of your rules, so its history entry can be deleted and the protection status can be shown in the popup and on the toolbar icon. |
| Recently closed tabs | `sessions` | Finds recently closed entries that match your rules so they can be removed. |
| Download records (optional) | `downloads` | Requested only if you turn on "clean download records". Matching entries are removed from the download list. Downloaded files are never deleted. |

The extension has no access to page content, cookies, passwords, or form data. It requests no site access permissions and injects no scripts into pages.

### What the extension stores

- **Your rules and settings** (the hosts, ports and path prefixes you entered, your notes, option switches, and the time of the last cleanup) are stored on your device in `chrome.storage.local`. They are not synced to your account or any other device.
- **Temporary working state** (for example, which protected addresses an open tab has visited) is kept in `chrome.storage.session`, which lives in memory only and is cleared when the browser closes.
- The extension keeps no log of the addresses it deletes.

### What the extension sends

Nothing. There are no analytics, no advertising, no remote code, and no third-party services. No data leaves your device through this extension.

### Exporting rules

If you use the export feature, your rules are saved as a JSON file on your own device. The file goes nowhere else, and what you do with it is up to you.

### Your control over the data

- Remove a rule or change a setting at any time on the options page.
- Uninstalling the extension deletes everything it stored.

### Changes to this policy

Any change will be published on this page with a new "Last updated" date.

### Contact

Questions about this policy can be raised at <https://github.com/Okuribito957/URL_History_Eraser/issues>.

## 中文

URL History Eraser 不收集、不传输、不出售、不共享任何个人信息。插件的全部工作都在您的浏览器本地完成，并且不发起任何网络请求。

### 插件访问哪些数据，用来做什么

插件的功能是清除您指定网站的浏览痕迹，为此需要在本机读取部分浏览器数据：

| 数据 | 权限 | 用途 |
|---|---|---|
| 浏览历史 | `history` | 找出命中规则的历史记录并删除。清理"最近关闭的标签页"时，可能会把命中的网址瞬间重新写入再立即删除，因为浏览器只有这样才会移除该条目。 |
| 已打开标签页的网址 | `tabs` | 判断标签页中的页面是否命中规则，以便删除对应的历史记录，并在弹窗和工具栏图标上显示保护状态。 |
| 最近关闭的标签页 | `sessions` | 找出命中规则的最近关闭条目并移除。 |
| 下载记录（可选） | `downloads` | 仅在您开启"清理下载记录"时才会申请。只从下载列表中移除命中的记录，不会删除已下载的文件。 |

插件读不到网页内容、Cookie、密码和表单数据；不申请任何网站访问权限，也不向网页注入脚本。

### 插件保存哪些数据

- **规则和设置**（您输入的域名、端口、路径前缀、备注、各项开关，以及上次清扫的时间）保存在本机的 `chrome.storage.local` 中，不会同步到您的账号或其他设备。
- **运行期间的临时状态**（例如某个标签页访问过哪些受保护网址）保存在 `chrome.storage.session` 中，只存在于内存，浏览器退出即清空。
- 插件不记录被删除的网址。

### 插件发送哪些数据

没有。插件不含统计分析、广告、远程代码，也不使用任何第三方服务，不会有数据通过本插件离开您的设备。

### 导出规则

使用导出功能时，规则会以 JSON 文件的形式保存到您自己的设备上，不会发往其他任何地方，之后如何处理由您决定。

### 您对数据的控制

- 可以随时在设置页删除规则或修改设置。
- 卸载插件会删除它保存的全部数据。

### 政策变更

本政策如有变更，会在本页面发布，并更新"Last updated"日期。

### 联系方式

对本政策有疑问，请在 <https://github.com/Okuribito957/URL_History_Eraser/issues> 提出。
