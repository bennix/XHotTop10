# XHotTop10

中文 | [English](#english)

一个 Chrome Manifest V3 扩展，用于在已登录的 X / Twitter 页面中寻找最近 24 小时内关于新闻、经济、战争、股票、科技和 IT 的热门帖子，返回前十大链接，并支持导出 Markdown 文件。

## 功能

- 在当前已登录的 X / Twitter 会话中运行，不处理账号密码。
- 自动打开 X 热门搜索页并滚动收集帖子。
- 默认滚动 5 页，支持用户指定 5 到 20 页。
- 只保留最近 24 小时内发布的帖子。
- 按可见互动数据估算热度，输出前十大热门帖子。
- 支持导出 Markdown 报告。
- 仅使用页面 DOM，不调用 X 私有 API。

## 安装

1. 下载或克隆本仓库。
2. 打开 Chrome 的 `chrome://extensions`。
3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本仓库目录。

## 使用方法

1. 在 Chrome 中打开 `https://x.com` 或 `https://twitter.com`，并确认已经登录。
2. 点击浏览器工具栏中的 XHotTop10 扩展图标。
3. 设置滚动页数，默认 5 页，可选 5 到 20 页。
4. 点击“开始扫描”。
5. 等待扩展收集并显示“24 小时内最热门的帖子 · 前十大”。
6. 点击“导出 MD”保存 Markdown 报告。

## 热度计算

扩展根据页面可见指标估算热度：

```text
likes * 3 + reposts * 4 + replies * 2 + bookmarks * 2 + views * 0.05
```

这是一个实用排序，不代表 X 官方热度分。

## 隐私说明

- 扩展不保存或读取 X 账号密码。
- 扩展只在 `x.com` 和 `twitter.com` 的搜索页执行内容脚本。
- 扫描结果会暂存在浏览器本地 `chrome.storage.local`，用于弹窗展示和导出。
- 导出的 Markdown 文件只保存在用户本机。

## 限制

- 结果取决于当前账号、地区、语言、X 搜索排序和页面加载状态。
- X 页面结构变化可能影响抓取结果。
- `since:YYYY-MM-DD` 搜索语法用于粗筛，扩展会再按帖子时间精确过滤最近 24 小时。

## 项目结构

```text
manifest.json
src/background.js
src/content.js
popup/popup.html
popup/popup.css
popup/popup.js
docs/claude-brainstorm-spec.md
```

## 开发验证

```bash
node --check src/background.js
node --check src/content.js
node --check popup/popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

---

## English

A Chrome Manifest V3 extension that finds the top 10 hottest X / Twitter posts from the last 24 hours about news, economy, war, stocks, technology, and IT. It runs in the user's already logged-in X session and can export the results as a Markdown file.

## Features

- Runs inside the current logged-in X / Twitter browser session.
- Opens X Top search results and automatically scrolls to collect posts.
- Defaults to 5 scroll pages, with a user-selectable range from 5 to 20.
- Keeps only posts published within the last 24 hours.
- Estimates post hotness from visible engagement metrics and returns the top 10 posts.
- Exports a Markdown report.
- Uses only the rendered page DOM. It does not call private X APIs.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable “Developer mode”.
4. Click “Load unpacked”.
5. Select this repository folder.

## Usage

1. Open `https://x.com` or `https://twitter.com` in Chrome and make sure you are logged in.
2. Click the XHotTop10 extension icon in the browser toolbar.
3. Choose the scroll page count. The default is 5, and the supported range is 5 to 20.
4. Click “开始扫描” to start scanning.
5. Wait for the extension to show the “Top 10 hottest posts in the last 24 hours” section.
6. Click “导出 MD” to save the Markdown report.

## Hotness Score

The extension estimates hotness from visible page metrics:

```text
likes * 3 + reposts * 4 + replies * 2 + bookmarks * 2 + views * 0.05
```

This is a practical ranking heuristic, not an official X score.

## Privacy

- The extension does not read or store X credentials.
- The content script only runs on `x.com` and `twitter.com` search pages.
- Scan results are temporarily stored in local browser storage for popup rendering and export.
- Exported Markdown files are saved locally by the user.

## Limitations

- Results depend on the current account, region, language, X search ranking, and page loading state.
- X DOM changes may affect extraction accuracy.
- `since:YYYY-MM-DD` is used as a broad search filter; the extension also filters posts precisely by timestamp to keep only the last 24 hours.

## Project Structure

```text
manifest.json
src/background.js
src/content.js
popup/popup.html
popup/popup.css
popup/popup.js
docs/claude-brainstorm-spec.md
```

## Development Checks

```bash
node --check src/background.js
node --check src/content.js
node --check popup/popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```
