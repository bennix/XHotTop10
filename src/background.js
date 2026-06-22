const TOPIC_QUERY = [
  "新闻",
  "经济",
  "战争",
  "股票",
  "科技",
  "IT",
  "news",
  "economy",
  "war",
  "stocks",
  "technology",
  "tech"
].join(" OR ");

const DEFAULT_STATE = {
  jobId: "",
  status: "idle",
  progress: 0,
  pages: 5,
  results: [],
  message: "",
  searchUrl: "",
  timeWindowHours: 24,
  startedAt: "",
  finishedAt: ""
};

const ACTIVE_JOB_KEY = "activeJob";
const NAVIGATION_TIMEOUT_MS = 30000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_SCAN") {
    startScan(message.pages).then(sendResponse);
    return true;
  }

  if (message.type === "GET_STATE") {
    getState().then(sendResponse);
    return true;
  }

  if (message.type === "SCAN_PROGRESS") {
    handleProgressMessage(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "SCAN_COMPLETE") {
    handleCompleteMessage(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "SCAN_ERROR") {
    handleErrorMessage(message, sender).then(sendResponse);
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  getActiveJob().then((job) => {
    if (!job || job.tabId !== tabId || !isSearchUrl(tab.url || "")) {
      return;
    }

    runContentScan(tabId, job.pages, job.jobId);
  });
});

async function startScan(pageInput) {
  const pages = clampPages(pageInput);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    await updateState({ ...DEFAULT_STATE, status: "error", message: "没有找到当前活动标签页" });
    return { ok: false };
  }

  if (!isAllowedXUrl(tab.url || "")) {
    await clearActiveJob();
    await updateState({
      ...DEFAULT_STATE,
      status: "error",
      message: "请先打开 x.com 或 twitter.com 页面后再扫描"
    });
    return { ok: false };
  }

  const searchUrl = buildSearchUrl(tab.url || "https://x.com/");
  const jobId = createJobId();
  await setActiveJob({ jobId, tabId: tab.id, pages });
  scheduleNavigationTimeout(jobId);

  await updateState({
    ...DEFAULT_STATE,
    jobId,
    status: "navigating",
    pages,
    searchUrl,
    timeWindowHours: 24,
    startedAt: new Date().toISOString(),
    message: "正在打开 X Top 搜索结果"
  });

  try {
    await chrome.tabs.update(tab.id, { url: searchUrl });
    return { ok: true };
  } catch (error) {
    await clearActiveJob();
    await updateState({
      status: "error",
      message: error.message || "无法打开 X 搜索页",
      finishedAt: new Date().toISOString()
    });
    return { ok: false };
  }
}

async function runContentScan(tabId, pages, jobId) {
  try {
    await sendRunMessage(tabId, pages, jobId);
  } catch (error) {
    const job = await getActiveJob();
    if (!job || job.jobId !== jobId) {
      return;
    }

    await updateState({
      status: "error",
      message: error.message || "无法启动内容脚本",
      finishedAt: new Date().toISOString()
    });
    await clearActiveJob();
  }
}

async function sendRunMessage(tabId, pages, jobId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "RUN_SCAN", pages, jobId, timeWindowHours: 24 });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    await chrome.tabs.sendMessage(tabId, { type: "RUN_SCAN", pages, jobId, timeWindowHours: 24 });
  }
}

function buildSearchUrl(currentUrl) {
  const host = getAllowedHost(currentUrl) === "twitter.com" ? "twitter.com" : "x.com";
  const encodedQuery = encodeURIComponent(`${TOPIC_QUERY} since:${formatSinceDate()}`);
  return `https://${host}/search?q=${encodedQuery}&src=typed_query&f=top`;
}

function formatSinceDate() {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function clampPages(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 5;
  }
  return Math.min(20, Math.max(5, parsed));
}

async function getState() {
  const stored = await chrome.storage.local.get("scanState");
  return stored.scanState || DEFAULT_STATE;
}

async function updateState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ scanState: next });
  return next;
}

async function handleProgressMessage(message, sender) {
  const job = await getVerifiedSenderJob(message, sender);
  const state = await getState();
  if (!job || ["done", "error"].includes(state.status)) {
    return { ok: false };
  }

  await updateState({
    status: "running",
    progress: clampProgress(message.progress),
    message: limitText(message.message || "", 120)
  });
  return { ok: true };
}

async function handleCompleteMessage(message, sender) {
  const job = await getVerifiedSenderJob(message, sender);
  if (!job) {
    return { ok: false };
  }

  const results = sanitizeResults(message.results || []);
  await updateState({
    status: "done",
    progress: 100,
    results,
    message: results.length ? `找到 ${results.length} 条热门帖子` : "扫描完成，但没有找到可用帖子",
    finishedAt: new Date().toISOString()
  });
  await clearActiveJob();
  return { ok: true };
}

async function handleErrorMessage(message, sender) {
  const job = await getVerifiedSenderJob(message, sender);
  if (!job) {
    return { ok: false };
  }

  await updateState({
    status: "error",
    message: limitText(message.message || "扫描失败", 160),
    finishedAt: new Date().toISOString()
  });
  await clearActiveJob();
  return { ok: true };
}

async function getVerifiedSenderJob(message, sender) {
  const job = await getActiveJob();
  const senderUrl = sender.url || sender.tab?.url || "";
  if (!job || message.jobId !== job.jobId || sender.tab?.id !== job.tabId || !isAllowedXUrl(senderUrl)) {
    return null;
  }
  return job;
}

function sanitizeResults(results) {
  return results
    .map((result) => {
      const url = normalizeStatusUrl(result?.url);
      if (!url) {
        return null;
      }

      return {
        rank: 0,
        url,
        text: limitText(result.text || "", 1200),
        author: limitText(result.author || "", 160),
        timestamp: limitText(result.timestamp || "", 40),
        metrics: sanitizeMetrics(result.metrics),
        score: toSafeNumber(result.score)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

function sanitizeMetrics(metrics = {}) {
  return {
    replies: toSafeNumber(metrics.replies),
    reposts: toSafeNumber(metrics.reposts),
    likes: toSafeNumber(metrics.likes),
    bookmarks: toSafeNumber(metrics.bookmarks),
    views: toSafeNumber(metrics.views)
  };
}

function normalizeStatusUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["x.com", "twitter.com"].includes(url.hostname)) {
      return "";
    }

    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) {
      return "";
    }

    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {
    return "";
  }
}

function isAllowedXUrl(value) {
  return Boolean(getAllowedHost(value));
}

function isSearchUrl(value) {
  try {
    const url = new URL(value);
    return Boolean(getAllowedHost(value)) && url.pathname === "/search";
  } catch {
    return false;
  }
}

function getAllowedHost(value) {
  try {
    const { hostname } = new URL(value);
    return ["x.com", "twitter.com"].includes(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function clampProgress(value) {
  const number = toSafeNumber(value);
  return Math.min(100, Math.max(0, number));
}

function toSafeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.round(number);
}

function limitText(value, maxLength) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function createJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getActiveJob() {
  const stored = await chrome.storage.session.get(ACTIVE_JOB_KEY);
  return stored[ACTIVE_JOB_KEY] || null;
}

async function setActiveJob(job) {
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: job });
}

async function clearActiveJob() {
  await chrome.storage.session.remove(ACTIVE_JOB_KEY);
}

function scheduleNavigationTimeout(jobId) {
  setTimeout(async () => {
    const job = await getActiveJob();
    const state = await getState();
    if (!job || job.jobId !== jobId || state.status !== "navigating") {
      return;
    }

    await updateState({
      status: "error",
      message: "X 搜索页加载超时，请确认页面已登录后重试",
      finishedAt: new Date().toISOString()
    });
    await clearActiveJob();
  }, NAVIGATION_TIMEOUT_MS);
}
