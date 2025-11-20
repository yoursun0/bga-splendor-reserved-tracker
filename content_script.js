// content_script.js
// Log-based reserved card tracking for BoardGameArena Splendor.
// Extracts reserve events from the game log (NOT from DOM selectors).
// Only the captureReserveLogs function is active; old RESERVED_SELECTORS approach is deprecated.

// Toggle verbose console debugging
const DEBUG = true;

// Safe helper to resolve an image URL for a bundled card image. In the
// extension runtime we prefer `chrome.runtime.getURL`, but in test harnesses
// or other environments that don't expose `chrome.runtime.getURL` we fall
// back to a relative `images/card_<id>.png` path so tests can still run.
function getCardImageUrl(id) {
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(`images/card_${id}.png`);
    }
  } catch (e) { /* ignore */ }
  return `images/card_${id}.png`;
}


// Capture all "reserve" log entries in chronological order and return
// an array of reserve events plus a by-player grouping. This is a lightweight
// helper used by the popup for interactive debugging.
function captureReserveLogs(logSelector) {
  const selector = logSelector || '#logs';
  if (DEBUG) console.log('[bga-reserved] captureReserveLogs: using selector', selector);
  const logsContainer = document.querySelector(selector) || document.getElementById('logs') || document.querySelector('#logs_wrap #logs');
  if (!logsContainer) {
    if (DEBUG) console.warn('[bga-reserved] captureReserveLogs: logs container NOT found for selector', selector);
    return { events: [], byPlayer: {} };
  }
  const logEls = Array.from(logsContainer.querySelectorAll('.log, .log_replayable'));
  if (DEBUG) console.log('[bga-reserved] captureReserveLogs: total log elements matched', logEls.length);
  if (!logEls.length) return { events: [], byPlayer: {} };

  // Sort oldest -> newest by numeric id (log_0, log_1 ...)
  logEls.sort((a, b) => {
    const ai = parseInt((a.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    const bi = parseInt((b.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    return ai - bi;
  });

  // Dump a few sample entries to help dry-run in console
  if (DEBUG) {
    logEls.slice(0, 6).forEach((le, i) => {
      try {
        console.log(`[bga-reserved] captureReserveLogs: sample[${i}] id=${le.id}`, (le.outerHTML || '').slice(0, 240));
      } catch (e) { /* ignore */ }
    });
  }

  const reserveRe = /\b(reserve|reserves|reserved)\b/i;
  const events = [];
  const buys = [];

  function getRowAndColorFromId(id) {
    const n = parseInt(id, 10);
    if (!Number.isFinite(n)) return { row: null, color: null };
    let rowNum = null;
    if (n >= 1 && n <= 40) rowNum = 1;
    else if (n >= 41 && n <= 70) rowNum = 2;
    else if (n >= 71 && n <= 90) rowNum = 3;

    // color mapping for reserve logs (id -> color)
    // reserve mapping: icon_C -> white, icon_S -> blue, icon_E -> green, icon_R -> red, icon_O -> black
    let colorName = 'black'; // default
    const inRanges = (ranges) => ranges.some(([a,b]) => n >= a && n <= b);
    if (inRanges([[1,8],[41,46],[71,74]])) colorName = 'white';
    else if (inRanges([[9,16],[47,52],[75,78]])) colorName = 'blue';
    else if (inRanges([[17,24],[53,58],[79,82]])) colorName = 'green';
    else if (inRanges([[25,32],[59,64],[83,86]])) colorName = 'red';

    return { rowNum, colorName };
  }

  logEls.forEach(logEl => {
    const rawText = ((logEl.innerText && logEl.innerText.trim()) || (logEl.textContent && logEl.textContent.trim()) || '').trim();
    if (DEBUG) console.log('[bga-reserved] captureReserveLogs: processing log', logEl.id || '(no id)', 'text', rawText.slice(0,120));
    if (!reserveRe.test(rawText)) {
      if (DEBUG) console.log('[bga-reserved] captureReserveLogs: skipping non-reserve log', logEl.id || '(no id)');
      // But also check for buy-from-hand logs
      const buyRe = /\bbuys\b/i;
      if (buyRe.test(rawText) && /from hand/i.test(rawText)) {
        // try to extract gem/color icon class from log HTML
        const outer = logEl.outerHTML || '';
        const colorMatch = outer.match(/class=\"[^\"]*?(icon_[A-Za-z])[^\\\"]*?\"/) || outer.match(/class='[^']*?(icon_[A-Za-z])[^']*?'/);
        const colorClass = colorMatch ? colorMatch[1] : null;
        // map buy-log color classes to canonical color names
        // buy mapping: icon_E -> white, icon_C -> blue, icon_R -> green, icon_O -> red, icon_S -> black
        let buyColorName = null;
        if (colorClass) {
          const m = (colorClass || '').toLowerCase();
          if (m === 'icon_e') buyColorName = 'white';
          else if (m === 'icon_c') buyColorName = 'blue';
          else if (m === 'icon_r') buyColorName = 'green';
          else if (m === 'icon_o') buyColorName = 'red';
          else if (m === 'icon_s') buyColorName = 'black';
        }
        // try to extract row circles like (◯◯◯)
        const rowMatch = rawText.match(/\((\u25EF+)\)/);
        const rowNum = rowMatch ? rowMatch[1].length : null;
        const playerSpan = logEl.querySelector('.playername');
        const playerName = playerSpan ? playerSpan.textContent.trim() : 'Unknown';
        const timestampEl = logEl.querySelector('.timestamp');
        const timestamp = timestampEl ? timestampEl.textContent.trim() : null;
        buys.push({ playerName, colorClass, colorName: buyColorName, rowNum, text: rawText, logId: logEl.id || null, timestamp, rawHtml: outer });
        if (DEBUG) console.log('[bga-reserved] captureReserveLogs: detected buy-from-hand', buys[buys.length-1]);
      }
      return; // skip non-reserve logs
    }

    const playerSpan = logEl.querySelector('.playername');
    const playerName = playerSpan ? playerSpan.textContent.trim() : 'Unknown';
    const playerColor = playerSpan ? (playerSpan.style && playerSpan.style.color) || getComputedStyle(playerSpan).color : null;
    const timestampEl = logEl.querySelector('.timestamp');
    const timestamp = timestampEl ? timestampEl.textContent.trim() : null;

    // Find tooltip nodes (explicit card mentions) - handles both visible and invisible cards
    const tooltips = Array.from(logEl.querySelectorAll('.spl_notif-inner-tooltip, .spl_notif-inner-tooltip[data-id]'));
    if (DEBUG) console.log('[bga-reserved] captureReserveLogs: found tooltips', tooltips.length);
    if (tooltips.length) {
      tooltips.forEach(tt => {
        const sourceId = tt.getAttribute('data-id') || null;
        const ttHtml = tt.outerHTML || '';
        const imageClass = (ttHtml.match(/spl_img_\d+/) || [null])[0];
        const cardType = (ttHtml.match(/type_[A-Za-z]/) || [null])[0];
        // Try to get an image URL from the tooltip DOM node
        let imageUrl = null;
        try {
          // prefer <img> or background-image on the tooltip node or its children
          const findImg = (node, depth = 6) => {
            if (!node || depth < 0) return null;
            if (node.tagName && node.tagName.toLowerCase() === 'img' && node.src) return node.src;
            try {
              const cs = window.getComputedStyle(node);
              if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') {
                const m = cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                if (m && m[1]) return m[1];
              }
            } catch (e) { /* ignore */ }
            const children = node.children || [];
            for (let i = 0; i < children.length; i++) {
              const r = findImg(children[i], depth - 1);
              if (r) return r;
            }
            return null;
          };
          const rawUrl = findImg(tt, 6);
          if (rawUrl) imageUrl = (new URL(rawUrl, location.href).href);
        } catch (e) { /* ignore */ }
        if (DEBUG) console.log('[bga-reserved] captureReserveLogs: tooltip ->', { sourceId, imageClass, cardType, imageUrl });
        const ev = { sourceId, playerName, playerColor, imageClass, cardType, imageUrl, text: rawText, logId: logEl.id || null, timestamp, rawHtml: ttHtml };
        if (sourceId) {
          const rc = getRowAndColorFromId(sourceId);
          ev.row = rc.rowNum; ev.color = rc.colorName;
        } else {
          ev.row = null; ev.color = null;
        }
        events.push(ev);
      });
    } else {
      // No explicit tooltip IDs found
      // Check if this is an "invisible/hidden card" reservation (text like "reserves a hidden/invisible card from row ◯◯")
      const outer = logEl.outerHTML || '';
      const isInvisible = /invisible|hidden/i.test(rawText);
      
      // For invisible/hidden cards, we may not have a sourceId, but still record the event
      if (isInvisible) {
        if (DEBUG) console.log('[bga-reserved] captureReserveLogs: invisible/hidden card reservation detected');
        const imageClass = (outer.match(/spl_img_\d+/) || [null])[0];
        const cardType = (outer.match(/type_[A-Za-z]/) || [null])[0];
        let imageUrl = null;
        try {
          const node = logEl;
          const findImg = (node, depth = 6) => {
            if (!node || depth < 0) return null;
            if (node.tagName && node.tagName.toLowerCase() === 'img' && node.src) return node.src;
            try {
              const cs = window.getComputedStyle(node);
              if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') {
                const m = cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                if (m && m[1]) return m[1];
              }
            } catch (e) { /* ignore */ }
            const children = node.children || [];
            for (let i = 0; i < children.length; i++) {
              const r = findImg(children[i], depth - 1);
              if (r) return r;
            }
            return null;
          };
          const rawUrl = findImg(node, 6);
          if (rawUrl) imageUrl = (new URL(rawUrl, location.href).href);
        } catch (e) { /* ignore */ }
        
        // Extract row from "from row ◯◯" pattern
        const rowMatch = rawText.match(/from row\s+(\u25EF+)/);
        const hiddenRow = rowMatch ? rowMatch[1].length : null;
        
        // Record invisible/hidden card with sourceId = null but row info
        const ev = { sourceId: null, playerName, playerColor, imageClass, cardType, imageUrl, text: rawText, logId: logEl.id || null, timestamp, isHidden: true, rawHtml: outer };
        ev.row = hiddenRow; ev.color = null;
        if (DEBUG) console.log('[bga-reserved] captureReserveLogs: hidden card with row', hiddenRow);
        events.push(ev);
      } else {
        // Fallback: try to find card ids or tt_card_XX patterns in the log HTML (for visible cards without explicit tooltip)
        const idMatch = outer.match(/(?:tt_card_|minicard_|card_)(\d+)/);
        const sourceId = idMatch ? idMatch[1] : null;
        const imageClass = (outer.match(/spl_img_\d+/) || [null])[0];
        const cardType = (outer.match(/type_[A-Za-z]/) || [null])[0];
        // try to pick up an image URL from actual DOM elements if present
        let imageUrl = null;
        try {
          const node = logEl;
          const findImg = (node, depth = 6) => {
            if (!node || depth < 0) return null;
            if (node.tagName && node.tagName.toLowerCase() === 'img' && node.src) return node.src;
            try {
              const cs = window.getComputedStyle(node);
              if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') {
                const m = cs.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
                if (m && m[1]) return m[1];
              }
            } catch (e) { /* ignore */ }
            const children = node.children || [];
            for (let i = 0; i < children.length; i++) {
              const r = findImg(children[i], depth - 1);
              if (r) return r;
            }
            return null;
          };
          const rawUrl = findImg(node, 6);
          if (rawUrl) imageUrl = (new URL(rawUrl, location.href).href);
        } catch (e) { /* ignore */ }
        if (DEBUG) console.log('[bga-reserved] captureReserveLogs: fallback parse ->', { sourceId, imageClass, cardType, imageUrl });
        const ev = { sourceId, playerName, playerColor, imageClass, cardType, imageUrl, text: rawText, logId: logEl.id || null, timestamp, rawHtml: outer };
        if (sourceId) {
          const rc = getRowAndColorFromId(sourceId);
          ev.row = rc.rowNum; ev.color = rc.colorName;
        } else { ev.row = null; ev.color = null; }
        events.push(ev);
      }
    }
  });

  const byPlayer = {};
  events.forEach(ev => {
    const key = ev.playerName || 'Unknown';
    if (!byPlayer[key]) byPlayer[key] = [];
    byPlayer[key].push(ev);
  });

  if (DEBUG) console.log('[bga-reserved] captureReserveLogs: finished capture, events:', events.length, 'buys:', buys.length);

  return { events, byPlayer, buys };
}

// Optional: listen for messages from popup to capture reserves
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'capture-reserves') {
    // return all reserve log entries (events + byPlayer grouping)
    try {
      const logSelector = msg.logSelector || '#logs';
      const result = captureReserveLogs(logSelector);
      sendResponse({ ok: true, result });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true; // async
  }
});


// --- Auto-reveal opponents' hidden mini-reserved cards in-page ---
// Periodically scans `div.spl_hand` for opponent hidden mini-cards
// (classes: `spl_card spl_hidden spl_back_* spl_miniversion`) and
// replaces them with local revealed thumbnails `images/card_<id>.png`.
// Mapping playerId -> playerName -> reserve events is built from
// `captureReserveLogs()` so we can pick the correct card id per row.

function findCurrentUserId() {
  try {
    // Primary: element #target_player_username contains username
    const userNameEl = document.getElementById('target_player_username');
    const userName = userNameEl ? userNameEl.textContent.trim() : null;
    if (userName) {
      // find matching player_name_<id>
      const nameEls = Array.from(document.querySelectorAll('[id^="player_name_"]'));
      for (const el of nameEls) {
        if (el.textContent && el.textContent.trim() === userName) {
          const m = el.id.match(/player_name_(\d+)/);
          if (m) return m[1];
        }
      }
    }
  } catch (e) { /* ignore */ }

  // Fallback: look for overall_player_board_* with class current-player-board
  try {
    const board = document.querySelector('[id^="overall_player_board_"]');
    if (board && board.className && board.className.indexOf('current-player-board') !== -1) {
      const m = board.id.match(/overall_player_board_(\d+)/);
      if (m) return m[1];
    }
  } catch (e) { /* ignore */ }

  // Last resort: try window.user_id if page exposes it
  try {
    if (window.user_id) return String(window.user_id);
    if (window.userId) return String(window.userId);
  } catch (e) { /* ignore */ }

  return null;
}

function buildPlayerIdToNameMap() {
  const map = {};
  try {
    const nameEls = Array.from(document.querySelectorAll('[id^="player_name_"]'));
    nameEls.forEach(el => {
      const m = el.id.match(/player_name_(\d+)/);
      if (m) map[m[1]] = el.textContent.trim();
    });
  } catch (e) { /* ignore */ }
  return map;
}

function pickLatestByRow(events) {
  // events: array of ev objects, returns map row->sourceId (most recent)
  const byRow = {};
  if (!Array.isArray(events)) return byRow;
  // iterate from newest -> oldest and take first per row
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev) continue;
    const row = ev.row || null;
    if (!row) continue;
    if (!byRow[row] && ev.sourceId) byRow[row] = ev.sourceId;
  }
  return byRow;
}

function revealHiddenMiniCardsOnce(byPlayerMap, playerIdToName, userId) {
  try {
    // Per-slot replacement approach: update each hidden mini-card element in-place
    const hands = Array.from(document.querySelectorAll('div.spl_hand'));
    hands.forEach(hand => {
      const handId = hand.id || '';
      const m = handId.match(/spl_hand_(\d+)/);
      if (!m) return;
      const playerId = m[1];
      if (!playerId || playerId === userId) return; // skip own hand

      const playerName = playerIdToName[playerId] || null;
      const eventsForPlayer = playerName && byPlayerMap[playerName] ? byPlayerMap[playerName] : [];

      // Build quick lookups: latest per row and latest N fallback
      const byRow = pickLatestByRow(eventsForPlayer);

      const hiddenSlots = Array.from(hand.querySelectorAll('.spl_card.spl_miniversion, .spl_card.spl_hidden, [id^="nb_hidden_"]'));
      if (!hiddenSlots.length) return;

      // Fallback list of most-recent card ids for the player (oldest-first)
      const fallbackIds = (function pickLatestNSourceIds(events, n) {
        if (!Array.isArray(events) || n <= 0) return [];
        const ids = events.filter(ev => ev && ev.sourceId).map(ev => ev.sourceId);
        return ids.slice(-n).reverse();
      })(eventsForPlayer, hiddenSlots.length);

      hiddenSlots.forEach((slot, idx) => {
        try {
          // Attempt to infer the card row from classes like `spl_back_1` / `spl_back_2` / `spl_back_3`
          let row = null;
          const cls = slot.className || '';
          const mb = cls.match(/spl_back_(\d)/);
          if (mb) row = parseInt(mb[1], 10);

          // Some hidden slots use id pattern `nb_hidden_<player>_<index>`, try to extract index
          if (!row) {
            const idm = (slot.id || '').match(/nb_hidden_\d+_(\d+)/);
            if (idm) row = parseInt(idm[1], 10);
          }

          // Decide which sourceId to show for this slot
          let sourceId = null;
          if (row && byRow[row]) sourceId = byRow[row];
          else sourceId = fallbackIds[idx] || null;

          if (!sourceId) {
            // nothing to reveal for this slot — if previously revealed, clear it
            if (slot.dataset && slot.dataset.bgaRevealed) {
              delete slot.dataset.bgaRevealed;
              while (slot.firstChild) slot.removeChild(slot.firstChild);
            }
            return;
          }

          // If already revealed with the same id, skip
          if (slot.dataset && slot.dataset.bgaRevealed === String(sourceId)) return;

          // Mark as revealed
          if (slot.dataset) slot.dataset.bgaRevealed = String(sourceId);

          // Preserve existing inline style and transform; replace contents with an <img>
          // but keep the slot element itself so we don't disturb BGA's layout listeners.
          while (slot.firstChild) slot.removeChild(slot.firstChild);

          const img = document.createElement('img');
          img.src = getCardImageUrl(sourceId);
          img.alt = '';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          img.style.display = 'block';

          // If image fails to load, fall back to a subtle placeholder
          img.addEventListener('error', () => {
            try {
              if (img.parentNode) {
                img.parentNode.removeChild(img);
                slot.style.background = '#222';
                slot.style.color = '#fff';
                slot.style.textAlign = 'center';
                slot.textContent = '?';
              }
            } catch (e) { /* ignore */ }
          });

          slot.appendChild(img);
        } catch (e) {
          if (DEBUG) console.warn('[bga-reserved] revealHiddenMiniCardsOnce: slot update error', e);
        }
      });
    });
  } catch (e) {
    if (DEBUG) console.warn('[bga-reserved] revealHiddenMiniCardsOnce: error', e);
  }
}

let __bga_reserved_interval = null;
let __bga_reserved_observer = null;

function startAutoReveal(intervalMs = 1500) {
  try {
    if (__bga_reserved_interval) return; // already running
    const userId = findCurrentUserId();
    if (DEBUG) console.log('[bga-reserved] startAutoReveal: userId', userId);

    const runOnce = () => {
      try {
        const playerIdToName = buildPlayerIdToNameMap();
        const captured = captureReserveLogs('#logs');
        const byPlayer = captured.byPlayer || {};
        revealHiddenMiniCardsOnce(byPlayer, playerIdToName, userId);
      } catch (e) {
        if (DEBUG) console.warn('[bga-reserved] startAutoReveal: runOnce error', e);
      }
    };

    // run immediately and then on interval
    runOnce();
    __bga_reserved_interval = setInterval(runOnce, intervalMs);

    // Also watch for DOM changes to player boards and hands to trigger immediate updates
    try {
      const boards = document.getElementById('player_boards') || document.body;
      __bga_reserved_observer = new MutationObserver((mutations) => {
        // quick throttle: do a single run on next microtask
        runOnce();
      });
      __bga_reserved_observer.observe(boards, { childList: true, subtree: true, attributes: false });
    } catch (e) { /* ignore */ }
  } catch (e) {
    if (DEBUG) console.warn('[bga-reserved] startAutoReveal: failed', e);
  }
}

function stopAutoReveal() {
  try {
    if (__bga_reserved_interval) { clearInterval(__bga_reserved_interval); __bga_reserved_interval = null; }
    if (__bga_reserved_observer) { __bga_reserved_observer.disconnect(); __bga_reserved_observer = null; }
  } catch (e) { /* ignore */ }
}

// Auto-reveal should be opt-in. Check `chrome.storage.local.autoRevealEnabled` and
// start/stop accordingly. Also listen for runtime messages to toggle at runtime.
try {
  if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
    chrome.storage.local.get({ autoRevealEnabled: false }, (items) => {
      if (items && items.autoRevealEnabled) {
        if (DEBUG) console.log('[bga-reserved] autoReveal enabled via storage -> starting');
        startAutoReveal(1500);
      } else {
        if (DEBUG) console.log('[bga-reserved] autoReveal disabled by default');
      }
    });
  } else {
    if (DEBUG) console.log('[bga-reserved] chrome.storage not available; auto-reveal disabled');
  }
} catch (e) {
  if (DEBUG) console.warn('[bga-reserved] storage check failed', e);
}

// Listen for runtime messages to toggle auto-reveal immediately
try {
  if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'auto-reveal-set') {
        const enabled = !!msg.enabled;
        if (enabled) startAutoReveal(1500);
        else stopAutoReveal();
        if (sendResponse) sendResponse({ ok: true });
      }
    });
  }
} catch (e) { if (DEBUG) console.warn('[bga-reserved] runtime listener install failed', e); }
