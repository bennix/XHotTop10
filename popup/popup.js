const pagesInput = document.querySelector("#pagesInput");
const scanButton = document.querySelector("#scanButton");
const exportButton = document.querySelector("#exportButton");
const statusText = document.querySelector("#statusText");
const progressBar = document.querySelector("#progressBar");
const resultList = document.querySelector("#resultList");

let currentState = null;
let pollTimer = null;

scanButton.addEventListener("click", async () => {
  const pages = clampPages(pagesInput.value);
  pagesInput.value = String(pages);
  scanButton.disabled = true;
  statusText.textContent = "正在启动扫描";

  try {
    const response = await chrome.runtime.sendMessage({ type: "START_SCAN", pages });
    if (!response?.ok) {
      scanButton.disabled = false;
    }
    startPolling();
  } catch (error) {
    scanButton.disabled = false;
    statusText.textContent = error.message || "无法连接扩展后台";
  }
});

exportButton.addEventListener("click", () => {
  if (!currentState?.results?.length) {
    return;
  }

  const markdown = buildMarkdown(currentState);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const fileDate = currentState.finishedAt ? new Date(currentState.finishedAt) : new Date();

  anchor.href = url;
  anchor.download = `x-hot-news-${formatFileTime(fileDate)}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener("DOMContentLoaded", () => {
  startPolling();
});

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  refreshState();
  pollTimer = setInterval(refreshState, 1000);
}

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    currentState = state;
    renderState(state);

    if (!["navigating", "running"].includes(state.status) && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (error) {
    scanButton.disabled = false;
    statusText.textContent = error.message || "无法读取扫描状态";
  }
}

function renderState(state) {
  const busy = ["navigating", "running"].includes(state.status);
  scanButton.disabled = busy;
  exportButton.disabled = !state.results?.length;
  exportButton.textContent = state.results?.length ? `导出 ${state.results.length} 条 MD` : "导出 MD";
  exportButton.title = state.results?.length ? "导出当前结果为 Markdown 文件" : "扫描完成后可导出";
  progressBar.style.width = `${state.progress || 0}%`;
  progressBar.parentElement.setAttribute("aria-valuenow", String(state.progress || 0));

  if (state.pages) {
    pagesInput.value = String(state.pages);
  }

  statusText.textContent = state.message || statusLabel(state.status);
  renderResults(state);
}

function renderResults(state) {
  const results = state.results || [];
  resultList.innerHTML = "";

  if (!results.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = emptyStateText(state);
    resultList.append(empty);
    return;
  }

  results.forEach((result) => {
    const item = document.createElement("li");
    item.className = "result";

    const link = document.createElement("a");
    link.href = safeStatusUrl(result.url) || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `#${result.rank} ${result.author ? "查看原帖" : "打开帖子"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [
      result.author,
      formatDisplayTime(result.timestamp),
      `热度 ${result.score}`,
      `赞 ${result.metrics.likes}`,
      `转 ${result.metrics.reposts}`,
      `评 ${result.metrics.replies}`,
      `看 ${result.metrics.views}`
    ]
      .filter(Boolean)
      .join(" | ");

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = result.text || result.author || result.url;

    item.append(link, meta, text);
    resultList.append(item);
  });
}

function buildMarkdown(state) {
  const finishedAt = state.finishedAt || new Date().toISOString();
  const lines = [
    "# X 热门帖子 Top 10",
    "",
    "## 摘要",
    "",
    `- 生成时间: ${new Date().toISOString()}`,
    `- 扫描开始: ${state.startedAt || ""}`,
    `- 扫描完成: ${finishedAt}`,
    `- 扫描状态: ${statusLabel(state.status)}`,
    `- 滚动页数: ${state.pages}`,
    `- 时间范围: 最近 ${state.timeWindowHours || 24} 小时`,
    `- 结果数: ${state.results.length}`,
    `- 搜索链接: ${state.searchUrl ? `[打开 X 搜索](${state.searchUrl})` : ""}`,
    "",
    "## 结果",
    ""
  ];

  state.results.forEach((result) => {
    const url = safeStatusUrl(result.url);
    if (!url) {
      return;
    }

    lines.push(
      `### ${result.rank}. ${escapeMarkdown(result.author || "X 帖子")}`,
      "",
      `- 链接: [打开原帖](${url})`,
      `- 时间: ${result.timestamp || ""}`,
      `- 热度分: ${result.score}`,
      `- 指标: 回复 ${result.metrics.replies} | 转发 ${result.metrics.reposts} | 喜欢 ${result.metrics.likes} | 收藏 ${result.metrics.bookmarks} | 浏览 ${result.metrics.views}`,
      "",
      result.text ? toBlockquote(result.text) : "",
      ""
    );
  });

  return `${lines.join("\n").trim()}\n`;
}

function emptyStateText(state) {
  if (state.status === "running" || state.status === "navigating") {
    return "正在收集 X 搜索结果";
  }
  if (state.status === "error") {
    return state.message || "扫描失败，请确认当前标签页是已登录的 X 页面";
  }
  if (state.status === "done") {
    return "扫描完成，但没有找到 24 小时内的可用帖子。可以增加滚动页数后重试。";
  }
  return "打开已登录的 X 页面后开始扫描";
}

function statusLabel(status) {
  const labels = {
    idle: "准备扫描",
    navigating: "正在打开 X 搜索页",
    running: "正在滚动并收集帖子",
    done: "扫描完成",
    error: "扫描失败"
  };
  return labels[status] || "准备扫描";
}

function clampPages(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 5;
  }
  return Math.min(20, Math.max(5, parsed));
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}[\]()#+])/g, "\\$1");
}

function formatFileTime(date) {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function formatDisplayTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function safeStatusUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "x.com" || !/^\/[^/]+\/status\/\d+$/.test(url.pathname)) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function toBlockquote(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
}
