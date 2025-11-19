# Copilot instructions for BGA Splendor Reserved Tracker

Brief: This repository is a Chrome extension (Manifest V3) that extracts opponent-reserved cards from BoardGameArena's Splendor game log and displays them in a popup UI with corresponding card images (card_XX.png from the local `images/` folder).

**Big picture**
- **What it is:** A Chrome extension (MV3) composed of a content script and a popup UI.
- **Key files:** `manifest.json`, `content_script.js`, `popup.html`, `popup.js`, `styles.css`, `images/card_*.png`.
- **Data flow:** `popup.js` sends `{type: 'capture-reserves', logSelector}` → `content_script.js` calls `captureReserveLogs()` to parse the game log (`#logs`) → extracts reserve events, groups them by player → `popup.js` renders each event with a thumbnail from `images/card_[sourceId].png`.

**Architecture & components**
- **Manifest (MV3):** `manifest.json` declares a content script that runs on `https://boardgamearena.com/*` and lists `images/` in `web_accessible_resources` for thumbnail access.
- **Content script (`content_script.js`):**
  - **Main function: `captureReserveLogs(logSelector)`** — Parses the game log container (default `#logs`) to extract all "reserve" actions.
  - Searches for `.log` and `.log_replayable` elements; filters for text matching `/reserve/i`.
  - For each reserve log entry, extracts:
    - `sourceId` (card ID from `data-id` attribute or fallback regex extraction from HTML)
    - `playerName` and `playerColor` (from `.playername` span)
    - `imageClass`, `cardType` (from `spl_img_*` and `type_*` classes)
    - `timestamp` (if present)
    - `text` (the log entry text)
  - Returns `{ events, byPlayer }` where `byPlayer` is a player-keyed map of ordered events.
  - **Debug logging:** Set `const DEBUG = true` to trace selector queries, matched elements, and per-log parsing.
  - **Message handler:** Listens for `{type: 'capture-reserves', logSelector}` and returns the captured result.
- **Popup (`popup.html` + `popup.js` + `styles.css`):**
  - **UI:** Log selector input (default `#logs`), `Capture Reserve Logs` button, `Clear` button, results panel.
  - **`makePreview(ev)`:** Renders card thumbnails using `images/card_[ev.sourceId].png`; falls back to `?` if file not found.
  - **`renderCaptureResults(result)`:** Groups events by player; displays each with thumbnail, card info, and an `Inspect` button to toggle raw HTML/text view.
  - **Selector editing:** Removed (no longer used).

**Project-specific conventions & patterns**
- **Log-only approach:** The extension relies **exclusively** on parsing the game log. The old DOM-selector approach (`RESERVED_SELECTORS`) has been removed.
- **Card thumbnails:** Stored locally as `images/card_[XX].png` where `XX` is the card ID (sourceId). If a file is missing, the preview shows `?`.
- **Message type:** `capture-reserves` with optional `logSelector` parameter.
- **Debug output:** Console logs prefixed with `[bga-reserved]` for content script messages; enable/disable via `const DEBUG = true/false`.

**Integration points & external dependencies**
- **Target host:** `https://boardgamearena.com/*` via `content_scripts` in `manifest.json`.
- **Chrome APIs used:** `chrome.runtime.onMessage`, `chrome.tabs.sendMessage`, `chrome.runtime.getURL` (for image paths).
- **Local images:** `images/card_[id].png` loaded via `chrome.runtime.getURL()`.
- **No build toolchain:** Plain JS/HTML/CSS files; load unpacked in Chrome.

**Developer workflows & debugging**
- **Load extension:** Chrome → `chrome://extensions` → Developer mode → `Load unpacked` → point to repo folder.
- **Testing flow:**
  1. Open a Splendor game or replay on BGA.
  2. Open extension popup (click extension icon).
  3. Verify log selector (default `#logs`) points to the game log container.
  4. Click `Capture Reserve Logs`.
  5. View results grouped by player; click `Inspect` to see raw log HTML/text for each event.
- **Console debugging:** Open DevTools Console (F12) on the BGA tab. Content script logs appear there (prefixed `[bga-reserved]`). Trace selector matches, log element counts, and per-event parsing.
- **Adding card images:** Download card face PNGs and save them as `images/card_[id].png`. The popup will automatically load them.

**What to avoid / known gotchas**
- The extension depends entirely on the game log HTML structure. If BGA changes the log container selector or class names (`.log`, `.log_replayable`, `.playername`, etc.), the capture will fail.
- If a card ID (`sourceId`) is not found or the image file is missing, the preview shows `?`.
- The capture happens on-demand (via button click), not continuously. Refreshing the page or navigating away clears the popup.
- The old `RESERVED_SELECTORS` and DOM scanning are now removed and no longer functional.

**Concrete examples to reference in the codebase**

*Game log structure (from live sample):*
- **Log container:** `#logs` (alternatively `#logs_wrap #logs`)
- **Log entries:** Elements with class `.log` or `.log_replayable` and `id="log_[N]"`
- **Player name:** `.playername` span within each log entry
- **Card reference:** `.spl_notif-inner-tooltip[data-id="[CARD_ID]"]` (explicit card ID) or fallback regex search for `tt_card_`, `minicard_`, `card_` patterns
- **Example reserve log:** `"Helic reserves a <span class="spl_notif-inner-tooltip" data-id="57">card</span>"`

*captureReserveLogs logic:*
```javascript
function captureReserveLogs(logSelector) {
  // 1. Locate log container
  const logsContainer = document.querySelector(logSelector) || document.getElementById('logs');
  
  // 2. Query all log entries
  const logEls = Array.from(logsContainer.querySelectorAll('.log, .log_replayable'));
  
  // 3. Sort by numeric ID (oldest → newest)
  logEls.sort((a, b) => parseLogIndex(a) - parseLogIndex(b));
  
  // 4. For each log:
  //    - Extract playerName from .playername
  //    - Filter for /reserve/i text
  //    - Find .spl_notif-inner-tooltip[data-id] or fallback regex
  //    - Extract sourceId, imageClass, cardType
  //    - Add to events array
  
  // 5. Group events by playerName
  
  // 6. Return { events, byPlayer }
}
```

*Thumbnail rendering in popup:*
```javascript
// Use card_[sourceId].png from images/ folder
img.src = chrome.runtime.getURL(`images/card_${ev.sourceId}.png`);
img.addEventListener('error', () => { /* fallback to '?' */ });
```

**Known issues and solutions (BUG TRACKER):**
- **(a) Missing thumbnails:** Verify `images/card_[id].png` files exist; check browser console for 404 errors.
- **(b) No events captured:** Check that log selector is correct (`#logs` by default); use DevTools Console to manually test `document.querySelector('#logs')`.
- **(c) Player name not extracted:** Ensure log entries have `.playername` span; inspect a live log entry in DevTools.
- **(d) Card ID (sourceId) is null:** Verify tooltip has `data-id` attribute or that log HTML contains `tt_card_`, `minicard_`, or `card_` patterns.

