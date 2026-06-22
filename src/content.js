(() => {
  if (window.__xHotNewsFinderInstalled) {
    return;
  }

  window.__xHotNewsFinderInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "RUN_SCAN") {
      return false;
    }

    scanHotPosts(message.pages, message.jobId, message.timeWindowHours)
      .then((results) => {
        chrome.runtime.sendMessage({ type: "SCAN_COMPLETE", jobId: message.jobId, results });
      })
      .catch((error) => {
        chrome.runtime.sendMessage({
          type: "SCAN_ERROR",
          jobId: message.jobId,
          message: error.message || "扫描失败"
        });
      });

    sendResponse({ ok: true });
    return false;
  });

  async function scanHotPosts(pageInput, jobId, timeWindowInput) {
    const pages = clampPages(pageInput);
    const minTimestampMs = Date.now() - clampTimeWindowHours(timeWindowInput) * 60 * 60 * 1000;
    const posts = new Map();
    let sequence = 0;

    await waitForTweets();

    for (let page = 1; page <= pages; page += 1) {
      sequence = collectVisiblePosts(posts, sequence, minTimestampMs);
      await reportProgress(jobId, page, pages);

      if (page < pages) {
        await scrollToNextPage();
      }
    }

    return Array.from(posts.values())
      .sort(comparePosts)
      .slice(0, 10)
      .map((post, index) => ({ ...post, rank: index + 1 }));
  }

  function collectVisiblePosts(posts, sequence, minTimestampMs) {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
      const post = extractPost(article, sequence, minTimestampMs);

      if (!post || !post.statusId) {
        return;
      }

      const previous = posts.get(post.statusId);
      if (!previous || post.score > previous.score) {
        posts.set(post.statusId, post);
      }
      sequence += 1;
    });
    return sequence;
  }

  function extractPost(article, sequence, minTimestampMs) {
    const status = getPrimaryStatus(article);

    if (!status) {
      return null;
    }

    const text = cleanText(findOwnElement(article, '[data-testid="tweetText"]')?.innerText || "");
    const author = cleanText(findOwnElement(article, '[data-testid="User-Name"]')?.innerText || "");
    const timestamp = findOwnElement(article, "time")?.getAttribute("datetime") || "";
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs < minTimestampMs) {
      return null;
    }

    const metrics = parseMetrics(article);
    const score = calculateScore(metrics);

    return {
      statusId: status.id,
      url: status.url,
      text,
      author,
      timestamp,
      metrics,
      score,
      sequence
    };
  }

  function getPrimaryStatus(article) {
    const directTimeLink = Array.from(article.querySelectorAll("time"))
      .filter((time) => time.closest('article[data-testid="tweet"]') === article)
      .map((time) => time.closest('a[href*="/status/"]'))
      .find(Boolean);

    const fallbackLink = Array.from(article.querySelectorAll('a[href*="/status/"]'))
      .filter((link) => link.closest('article[data-testid="tweet"]') === article)
      .find(Boolean);

    return normalizeStatusUrl(directTimeLink?.href || fallbackLink?.href || "");
  }

  function findOwnElement(article, selector) {
    return Array.from(article.querySelectorAll(selector)).find(
      (node) => node.closest('article[data-testid="tweet"]') === article
    );
  }

  function normalizeStatusUrl(href) {
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!match) {
        return null;
      }
      return {
        id: match[2],
        url: `https://x.com/${match[1]}/status/${match[2]}`
      };
    } catch {
      return null;
    }
  }

  function parseMetrics(article) {
    const metrics = {
      replies: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      views: 0
    };

    article.querySelectorAll("[aria-label]").forEach((node) => {
      if (node.closest('article[data-testid="tweet"]') !== article) {
        return;
      }

      const label = node.getAttribute("aria-label") || "";
      label.split(/,\s*/).forEach((part) => applyMetricPart(metrics, part));
    });

    return metrics;
  }

  function applyMetricPart(metrics, part) {
    const value = parseMetricValue(part);
    if (!value) {
      return;
    }

    const lower = part.toLowerCase();
    if (/(reply|replies|回复)/.test(lower)) {
      metrics.replies = Math.max(metrics.replies, value);
    } else if (/(repost|retweet|转帖|转发)/.test(lower)) {
      metrics.reposts = Math.max(metrics.reposts, value);
    } else if (/(like|likes|喜欢|点赞)/.test(lower)) {
      metrics.likes = Math.max(metrics.likes, value);
    } else if (/(bookmark|bookmarks|书签|收藏)/.test(lower)) {
      metrics.bookmarks = Math.max(metrics.bookmarks, value);
    } else if (/(view|views|查看|浏览)/.test(lower)) {
      metrics.views = Math.max(metrics.views, value);
    }
  }

  function parseMetricValue(text) {
    const normalized = text.replace(/,/g, "").trim();
    const compactMatch = normalized.match(/(\d+(?:\.\d+)?)\s*([KMB万亿]?)/i);

    if (!compactMatch) {
      return 0;
    }

    const number = Number.parseFloat(compactMatch[1]);
    const suffix = compactMatch[2].toLowerCase();
    const multipliers = {
      k: 1000,
      m: 1000000,
      b: 1000000000,
      "万": 10000,
      "亿": 100000000
    };

    return Math.round(number * (multipliers[suffix] || 1));
  }

  function calculateScore(metrics) {
    return Math.round(
      metrics.likes * 3 +
        metrics.reposts * 4 +
        metrics.replies * 2 +
        metrics.bookmarks * 2 +
        metrics.views * 0.05
    );
  }

  async function reportProgress(jobId, page, pages) {
    const progress = Math.min(95, Math.round((page / Math.max(pages, 1)) * 95));
    try {
      await chrome.runtime.sendMessage({
        type: "SCAN_PROGRESS",
        jobId,
        progress,
        message: `已扫描 ${Math.min(page, pages)} / ${pages} 页`
      });
    } catch {
      // The final completion message will surface any persistent runtime issue.
    }
  }

  async function waitForTweets() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      if (document.querySelector('article[data-testid="tweet"]')) {
        return;
      }
      await delay(350);
    }
    throw new Error("X 搜索结果没有加载出帖子，请确认已登录并稍后重试");
  }

  async function scrollToNextPage() {
    const beforeY = window.scrollY;
    const beforeIds = getVisibleStatusIds();

    window.scrollBy({ top: Math.max(window.innerHeight * 0.95, 760), behavior: "smooth" });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 3500) {
      await delay(250);
      const moved = window.scrollY > beforeY + 80;
      const changed = hasNewVisibleStatus(beforeIds);
      if (moved && changed) {
        return;
      }
    }
  }

  function getVisibleStatusIds() {
    return new Set(
      Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
        .map((article) => getPrimaryStatus(article)?.id)
        .filter(Boolean)
    );
  }

  function hasNewVisibleStatus(previousIds) {
    return Array.from(getVisibleStatusIds()).some((id) => !previousIds.has(id));
  }

  function comparePosts(a, b) {
    return (
      b.score - a.score ||
      b.metrics.views - a.metrics.views ||
      b.metrics.likes - a.metrics.likes ||
      b.metrics.reposts - a.metrics.reposts ||
      a.sequence - b.sequence
    );
  }

  function clampPages(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 5;
    }
    return Math.min(20, Math.max(5, parsed));
  }

  function clampTimeWindowHours(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 24;
    }
    return Math.min(24, Math.max(1, parsed));
  }

  function cleanText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
