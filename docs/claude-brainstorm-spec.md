# X Hot News Finder - Technical Implementation Spec

## Product Summary

Build a Chrome Manifest V3 extension that runs against the user's already logged-in X session. It searches X Top results for posts related to news, economy, war, stocks, technology, and IT, scrolls through a configurable number of result pages, ranks collected posts by visible engagement metrics, returns the top 10 links, and exports the collected result summary as a Markdown file.

The extension must not bypass login, scrape private APIs, or require external services. It operates through the current browser tab and the DOM that X renders for the logged-in user.

## In Scope

- Chrome MV3 extension with popup UI.
- Default scan depth of 5 pages.
- User-configurable scan depth from 5 to 20 pages.
- Automatic navigation to an X Top search URL covering:
  - 新闻, 经济, 战争, 股票, 科技, IT
  - news, economy, war, stocks, technology, tech
- Automatic scrolling by viewport-height pages.
- Collection of visible posts from X tweet article elements.
- Ranking by visible engagement metrics.
- Popup display of the top 10 post links and summary text.
- Markdown export from the popup.

## Out of Scope

- X API integration.
- Login automation or credential handling.
- Guaranteeing global X-wide popularity beyond what X returns to the current account/session.
- Persistent scheduled monitoring.
- Cross-browser packaging.

## User Flow

1. User opens any `x.com` or `twitter.com` tab while logged in.
2. User opens the extension popup.
3. User chooses a scroll page count between 5 and 20. Default is 5.
4. User clicks scan.
5. Extension navigates the active tab to X Top search results for the target topics.
6. Extension scrolls the page, extracts visible posts, ranks them, and stores results.
7. Popup shows top 10 links.
8. User exports the results to a `.md` file.

## Acceptance Criteria

- Loading the unpacked extension succeeds in Chrome.
- The popup can start a scan from an active X tab.
- Scan depth defaults to 5 and is clamped to 5-20.
- The content script scrolls automatically and reports progress.
- The result list contains no duplicate status URLs.
- The result list is sorted by engagement score descending.
- The popup can download a Markdown file containing title, generated time, search URL, rank, link, text, author, timestamp, score, and metrics.
- JSON and JavaScript syntax checks pass.

## Architecture

- `manifest.json`: MV3 metadata, permissions, host matches, background worker, popup, and content script registration.
- `src/background.js`: owns scan state, navigates active tab to X search, starts content-script scanning, receives progress/results.
- `src/content.js`: extracts posts, parses metrics, scrolls 5-20 pages, returns ranked results.
- `popup/popup.html`: compact popup markup.
- `popup/popup.css`: popup styling.
- `popup/popup.js`: starts scan, polls state, renders results, exports Markdown.

## Ranking Model

Use only visible DOM metrics. Score:

`likes * 3 + reposts * 4 + replies * 2 + bookmarks * 2 + views * 0.05`

This is a practical approximation because X does not expose a public "hotness" score in the DOM.

## Risks and Assumptions

- X DOM and labels may change; selectors should use stable `data-testid` and status links where possible.
- Localized metric labels vary; parser should support common English and Chinese labels.
- X search ranking is session-dependent, so results reflect the current logged-in account and X's Top search ranking at scan time.
