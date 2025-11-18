# Copilot instructions for BGA Splendor Reserved Tracker

Brief: This repository is a minimal Chrome extension (Manifest V3) that heuristically detects opponent-reserved cards on BoardGameArena's Splendor page and exposes them to a popup. The extension is intentionally small and intended for experimentation — selectors must be adapted to the live BGA DOM.

**Big picture**
- **What it is:** A Chrome extension (MV3) composed of a content script, a background service worker, and a popup UI.
- **Key files:** `manifest.json`, `content_script.js`, `background.js`, `popup.html`, `popup.js`, `README.md`.
- **Data flow:** `content_script.js` scans the game DOM -> writes snapshot to `chrome.storage.local` and sends a runtime message (`{type: 'reserved-update', cards}`) -> `background.js` also listens and saves the same data -> `popup.js` reads from storage or requests a force-scan via `chrome.tabs.sendMessage({type:'force-scan'})`.

**Architecture & components**
- **Manifest (MV3):** `manifest.json` declares `background.service_worker = background.js` and a content script that runs on `https://boardgamearena.com/*`.
- **Content script (`content_script.js`):**
  - Heuristic scanning using `RESERVED_SELECTORS` and a fallback that searches DOM text for "reserved".
  - Uses a `MutationObserver` to re-scan on DOM changes and deduplicates updates via `lastSnapshot`.
  - Exposes message handlers: `force-scan` (returns `reservedCards`) and `update-selectors` (replace runtime selectors array).
  - Persists results to `chrome.storage.local` and also posts `{type: 'reserved-update', cards}` messages.
- **Background (`background.js`):**
  - Lightweight MV3 service worker listening for `reserved-update` messages and writing `reservedCards` to `chrome.storage.local` for quick popup retrieval.
- **Popup (`popup.html` + `popup.js`):**
  - UI to show detected cards, a `Refresh` button that sends `force-scan`, and a textarea to edit selectors (saved to `reservedSelectors` in storage).
  - Uses `chrome.tabs.sendMessage` to talk to the content script in the active tab.

**Project-specific conventions & patterns**
- **Selectors-first design:** The extension relies on CSS selectors (array `RESERVED_SELECTORS` in `content_script.js`) — change these to match BGA's live DOM. The popup persists `reservedSelectors` to `chrome.storage.local`; editing there updates the content script at runtime with `update-selectors` messages.
- **Message types:** Use literal `type` values seen in the code: `reserved-update`, `force-scan`, `update-selectors`. Keep payload shapes consistent (`{type, cards}` or `{type, selectors}`).
- **Storage keys:** `reservedCards` and `reservedSelectors` are the canonical keys stored in `chrome.storage.local`.
- **Lightweight mutation handling:** The content script scans on any mutation; avoid expensive DOM operations. Follow the `findReservedCards()` and `snapshotString()` pattern for idempotent updates.

**Integration points & external dependencies**
- **Target host:** `https://boardgamearena.com/*` is whitelisted via `host_permissions` in `manifest.json`.
- **Chrome APIs used:** `chrome.storage.local`, `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`, `chrome.tabs.query`, `chrome.tabs.sendMessage` — expect asynchronous callbacks and the MV3 service worker lifecycle.
- **No build toolchain:** This repo has no bundler or build step — files are plain JS/HTML/CSS. Loading unpacked in Chrome is the primary dev workflow.

**Developer workflows & debugging**
- **Load extension:** Open Chrome → `chrome://extensions` → enable Developer mode → `Load unpacked` → point to repository folder.
- **Iterating selectors:** Open a Splendor game on BGA, open DevTools to inspect elements that represent reserved cards, then either:
  - Edit `content_script.js` `RESERVED_SELECTORS` and reload the extension in `chrome://extensions`, or
  - Paste selectors into the popup textarea and click `Save Selectors` to push them to the content script at runtime.
- **Testing flow:** With the extension loaded and the game page open:
  1. Click the extension icon to open the popup.
  2. Click `Refresh` (the popup sends `force-scan` to the content script).
  3. Inspect `chrome.storage.local` for `reservedCards` (via DevTools → Application → Storage → Extensions) or watch console logs.
- **Service worker logs:** Because `background.js` is an MV3 service worker, view logs via the extension page (click "service worker" link in the extension details) or via `chrome://inspect/#service-workers`.

**What to avoid / known gotchas**
- The BGA UI may render via canvas or obfuscated classes — DOM selectors may not exist. In that case, manual inspection of game JS or network frames is required (outside the scope of this starter).
- MV3 service worker is ephemeral: keep long-running logic in content scripts; use background only for cross-tab/global state.
- Cross-origin frames or invalid selectors may throw — content script catches selector errors but be cautious when adding complex selectors.

**Concrete examples to reference in the codebase**

*BGA Splendor DOM structure (from live game sample):*
- **Cards in play:** `#cards > div.spl_cardrow > div#card_XYZ.spl_card` (main game cards, rows 1-3)
- **Player reserved area:** `#player_reserve.spl_cardrow` (contains reserved cards for current player)
- **Opponent player panels:** `#opponents > div[id^="player_"]` (look here for opponent reserved cards)
- **Key IDs/classes:** `spl_card` (all card elements), `spl_cardrow` (rows), `type_X` (color codes)

*RESERVED_SELECTORS in `content_script.js`:*
```javascript
const RESERVED_SELECTORS = [
  '#player_reserve .spl_card',           // Cards in player's reserved area
  '#spl_playertable [id^="player_reserved_card"]', // Reserved card ID pattern
  'div[id^="player_"][id*="reserve"] .spl_card', // Dynamic opponent reserved cards
];
```
These selectors target BGA's actual Splendor DOM structure. For opponent reserved cards, the key is finding `#opponents` and then drilling into player-specific containers with `[id*="reserve"]`.

*Code references:*
- `content_script.js`: Update `RESERVED_SELECTORS` array to match opponent reserved card areas
- `popup.js`: Uses `chrome.tabs.sendMessage(tabs[0].id, { type: 'force-scan' }, ...)` to force rescan
- `background.js`: Listens for `{type:'reserved-update'}` and persists to `chrome.storage.local`

*Developer workflow for selector refinement:*
1. Open live Splendor game on BGA; play a few turns to get opponent reserved cards visible
2. Press F12 → Elements tab; right-click opponent's reserved card → Inspect
3. Note the ID/class chain (e.g., `#player_14 > div#player_reserve > div#card_XX.spl_card`)
4. Test in DevTools Console: `document.querySelectorAll('YOUR_SELECTOR_HERE').length > 0`
5. Paste working selector into popup textarea, click "Save Selectors" for immediate runtime test
6. Check DevTools → Application → Storage → Extensions → `reservedCards` to verify detection

If opponent cards still don't show, they may be in a hidden panel or rendered asynchronously. Look for `display:none` or check if panels expand on-demand.