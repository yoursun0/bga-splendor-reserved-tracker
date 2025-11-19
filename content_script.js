// content_script.js
// Minimal heuristic scanning + MutationObserver to detect "reserved" cards.
// NOTE: BoardGameArena's real DOM/classes may differ; open DevTools and adapt RESERVED_SELECTORS.

const RESERVED_SELECTORS = [
  // BGA Splendor selectors (adapted from live DOM analysis)
  '#player_reserve .spl_card',                    // Player's reserved cards in main game area
  '#spl_miniplayerboard .spl_hand [id^="minicard_"]',  // Opponent reserved cards in left player panels
  '.player-board .spl_hand [id^="minicard_"]',   // Fallback: opponent reserved cards in any player board
  'div[id^="spl_hand_"] [id^="minicard_"]',      // Specific opponent hand containers
  'div[id^="player_"][id*="reserve"] .spl_card', // Dynamic player reserve areas if they exist
];

let lastSnapshot = '';

function extractCardInfo(el) {
  // Try to gather useful info that will help you identify the card
  const id = el.dataset.cardId || el.id || el.getAttribute('data-card-id') || null;
  const text = (el.innerText || '').trim().slice(0, 200);
  const html = el.outerHTML;
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect().toJSON() : {};
  
  // Extract visual card image class (spl_img_1 through spl_img_6)
  const classStr = el.className || '';
  const imageClassMatch = classStr.match(/spl_img_\d+/);
  const imageClass = imageClassMatch ? imageClassMatch[0] : null;
  
  // Extract card type/color class (type_C, type_S, type_E, type_R, type_O, type_G)
  const typeMatch = classStr.match(/type_[A-Z]/);
  const cardType = typeMatch ? typeMatch[0] : null;
  
  return { id, text, html, rect, imageClass, cardType };
}

function findReservedCards() {
  const found = new Map();
  for (const sel of RESERVED_SELECTORS) {
    try {
      document.querySelectorAll(sel).forEach(el => {
        const info = extractCardInfo(el);
        const key = info.id || info.text || info.html.slice(0,80);
        if (!found.has(key)) found.set(key, info);
      });
    } catch (err) {
      // ignore invalid selectors or cross-origin frames
      // console.warn('Selector error', sel, err);
    }
  }
  // As a fallback, search for nodes which contain the word "Reserved" (case-insensitive)
  const textNodes = Array.from(document.querySelectorAll('div,span'))
    .filter(n => /reserved/i.test(n.innerText || ''))
    .slice(0, 30);
  textNodes.forEach(n => {
    const info = extractCardInfo(n);
    const key = info.id || info.text || info.html.slice(0,80);
    if (!found.has(key)) found.set(key, info);
  });

  // Additionally, parse the game log to reconstruct reserved cards (works for end-game DOM)
  // The log entries include elements like: <span class="spl_notif-inner-tooltip" data-id="54">a visible card</span>
  // We replay the log from oldest -> newest and apply 'reserves' and 'buys' events to build current reserved set.
  try {
    const logReserved = parseLogsForReserved();
    logReserved.forEach(info => {
      const key = info.id || info.html || (info.source && `log_${info.sourceId}`) || (info.text || '').slice(0,80);
      if (!found.has(key)) found.set(key, info);
    });
  } catch (e) {
    // ignore log parsing errors
  }

  return Array.from(found.values());
}

// Parse the historical game log to reconstruct current reserved cards.
// Returns an array of card info objects (same shape as extractCardInfo plus owner and source markers).
function parseLogsForReserved() {
  const logsContainer = document.getElementById('logs') || document.querySelector('#logs_wrap #logs') || document.querySelector('#logs');
  if (!logsContainer) return [];
  const logEls = Array.from(logsContainer.querySelectorAll('.log, .log_replayable'));
  if (!logEls.length) return [];

  // Sort by numeric id ascending so we replay oldest->newest (ids like log_0, log_1...)
  logEls.sort((a, b) => {
    const ai = parseInt((a.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    const bi = parseInt((b.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    return ai - bi;
  });

  const reservedMap = new Map(); // key: data-id (string) -> info
  const perPlayerStack = new Map(); // playerName -> array of sourceIds (in order reserved)

  // Regexes to detect relevant actions. We explicitly ignore generic "gets"/"scores" logs.
  const reserveRe = /\b(reserve|reserves|reserved)\b/i;
  const buyRe = /\b(buy|buys|bought)\b/i;
  const ignoreRe = /\b(gets|get|takes?|scores?|gains?)\b/i;

  logEls.forEach(logEl => {
    const rawText = (logEl.innerText || '').trim();
    const fullText = rawText.toLowerCase();
    const playerSpan = logEl.querySelector('.playername');
    const playerName = playerSpan ? playerSpan.textContent.trim() : null;
    const playerColor = playerSpan ? (playerSpan.style && playerSpan.style.color) || getComputedStyle(playerSpan).color : null;

    // Skip irrelevant logs early (e.g., gem takes, scoring)
    if (ignoreRe.test(fullText) && !reserveRe.test(fullText) && !buyRe.test(fullText)) return;

    const tooltips = Array.from(logEl.querySelectorAll('.spl_notif-inner-tooltip[data-id]'));

    if (tooltips.length) {
      // There are explicit tooltip ids referenced in this log
      tooltips.forEach(tt => {
        const sourceId = tt.getAttribute('data-id');
        if (!sourceId) return;

        if (reserveRe.test(fullText)) {
          // Reserve action -> record it
          const selectors = [`#card_${sourceId}`, `#minicard_${sourceId}`, `[id$="_${sourceId}"]`];
          let el = null;
          for (const s of selectors) {
            try { el = document.querySelector(s); } catch (e) { el = null; }
            if (el) break;
          }

          const info = el ? extractCardInfo(el) : { id: `card_${sourceId}`, text: (tt.textContent || 'reserved card').trim(), html: tt.outerHTML, rect: {}, imageClass: null, cardType: null };
          // If DOM element wasn't found, try to glean imageClass/cardType from the tooltip or nearby HTML
          if (!el) {
            try {
              const ttHtml = tt.outerHTML || '';
              const imgMatch = ttHtml.match(/spl_img_\d+/);
              if (imgMatch) info.imageClass = imgMatch[0];
              const typeMatch = ttHtml.match(/type_[A-Za-z]/i) || ttHtml.match(/type_[A-Z]+/i);
              if (typeMatch) info.cardType = typeMatch[0];
              const nearby = tt.closest('.roundedbox') || tt.parentElement;
              if (nearby) {
                const nearbyHtml = nearby.innerHTML || '';
                const imgMatch2 = nearbyHtml.match(/spl_img_\d+/);
                if (imgMatch2 && !info.imageClass) info.imageClass = imgMatch2[0];
                const typeMatch2 = nearbyHtml.match(/type_[A-Za-z]/i) || nearbyHtml.match(/type_[A-Z]+/i);
                if (typeMatch2 && !info.cardType) info.cardType = typeMatch2[0];
              }
            } catch (e) { /* ignore */ }
          }
          // try to augment row info from surrounding log text
          const rowMatch = rawText.match(/from\s+row\s*([◯○●◻○\s]+)/i) || rawText.match(/from\s+hand\s*\(([^)]+)\)/i);
          if (rowMatch) info.row = rowMatch[1].trim();
          // attach chronological index for tie-breaking
          if (typeof window !== 'undefined' && typeof window.__bga_log_idx === 'undefined') window.__bga_log_idx = 0;
          window.__bga_log_idx = (window.__bga_log_idx || 0) + 1;
          info.logIndex = window.__bga_log_idx;
          info.owner = { name: playerName, color: playerColor };
          info.source = 'log';
          info.sourceId = sourceId;
          reservedMap.set(String(sourceId), info);

          // push onto player's stack
          if (playerName) {
            if (!perPlayerStack.has(playerName)) perPlayerStack.set(playerName, []);
            perPlayerStack.get(playerName).push(String(sourceId));
          }
        } else if (buyRe.test(fullText)) {
          // Buy that references an explicit id -> remove it
          reservedMap.delete(String(sourceId));
          // also remove from any player's stack if present
          perPlayerStack.forEach((arr) => {
            const idx = arr.indexOf(String(sourceId));
            if (idx !== -1) arr.splice(idx, 1);
          });
        }
      });
    } else {
      // No tooltip IDs. Only act on explicit buys; ignore generic "gets"/"scores" logs.
      if (!buyRe.test(fullText)) return;

      // Extract gem/icon class from the log element HTML (e.g., icon_R, icon_E)
      let buyType = null;
      const iconEl = Array.from(logEl.querySelectorAll('*')).find(n => {
        const cls = n.className || '';
        return /icon_[A-Za-z0-9_]+/.test(cls) || /spl_log_gem|spl_log_coin/.test(cls);
      });
      if (iconEl) {
        const cls = iconEl.className || '';
        const m = cls.match(/icon_([A-Z])/i) || cls.match(/icon_([A-Za-z]+)/i);
        if (m) buyType = 'type_' + m[1].toUpperCase();
      }

      // Extract row/hand marker (e.g., "from row ◯◯" or "from hand (◯◯)")
      let buyRow = null;
      const rowMatch = rawText.match(/from\s+row\s*([◯○●◻○\s]+)/i);
      if (rowMatch) buyRow = rowMatch[1].trim();
      else {
        const handMatch = rawText.match(/from\s+hand\s*\(([^)]+)\)/i);
        if (handMatch) buyRow = handMatch[1].trim();
      }

      // Candidate IDs for this player (from their reserve stack, most recent first)
      let candidateId = null;
      if (playerName && perPlayerStack.has(playerName)) {
        const stack = perPlayerStack.get(playerName);
        for (let i = stack.length - 1; i >= 0; i--) {
          const sid = stack[i];
          const info = reservedMap.get(sid);
          if (!info) continue;
          const rowMatchOk = buyRow && info.row && info.row === buyRow;
          const typeMatchOk = buyType && info.cardType && info.cardType.toUpperCase() === buyType.toUpperCase();
          if (rowMatchOk && typeMatchOk) { candidateId = sid; break; }
          if (typeMatchOk && !candidateId) candidateId = sid;
          if (!buyType && !buyRow && !candidateId) candidateId = sid; // fallback: most recent
        }
      }

      if (candidateId) {
        reservedMap.delete(candidateId);
        perPlayerStack.forEach((arr) => {
          const idx = arr.indexOf(String(candidateId));
          if (idx !== -1) arr.splice(idx, 1);
        });
      }
    }
  });

  // Return remaining reserved card infos
  return Array.from(reservedMap.values());
}

// Capture all "reserve" log entries in chronological order and return
// an array of reserve events plus a by-player grouping. This is a lightweight
// helper used by the popup for interactive debugging.
function captureReserveLogs(logSelector) {
  const selector = logSelector || '#logs';
  const logsContainer = document.querySelector(selector) || document.getElementById('logs') || document.querySelector('#logs_wrap #logs');
  if (!logsContainer) return { events: [], byPlayer: {} };
  const logEls = Array.from(logsContainer.querySelectorAll('.log, .log_replayable'));
  if (!logEls.length) return { events: [], byPlayer: {} };

  // Sort oldest -> newest by numeric id (log_0, log_1 ...)
  logEls.sort((a, b) => {
    const ai = parseInt((a.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    const bi = parseInt((b.id || '').match(/log_(\d+)/)?.[1] || '0', 10);
    return ai - bi;
  });

  const reserveRe = /\b(reserve|reserves|reserved)\b/i;
  const events = [];

  logEls.forEach(logEl => {
    const rawText = (logEl.innerText || '').trim();
    if (!reserveRe.test(rawText)) return; // skip non-reserve logs

    const playerSpan = logEl.querySelector('.playername');
    const playerName = playerSpan ? playerSpan.textContent.trim() : 'Unknown';
    const playerColor = playerSpan ? (playerSpan.style && playerSpan.style.color) || getComputedStyle(playerSpan).color : null;
    const timestampEl = logEl.querySelector('.timestamp');
    const timestamp = timestampEl ? timestampEl.textContent.trim() : null;

    // Find tooltip nodes (explicit card mentions)
    const tooltips = Array.from(logEl.querySelectorAll('.spl_notif-inner-tooltip, .spl_notif-inner-tooltip[data-id]'));
    if (tooltips.length) {
      tooltips.forEach(tt => {
        const sourceId = tt.getAttribute('data-id') || null;
        const ttHtml = tt.outerHTML || '';
        const imageClass = (ttHtml.match(/spl_img_\d+/) || [null])[0];
        const cardType = (ttHtml.match(/type_[A-Za-z]/) || [null])[0];
        events.push({ sourceId, playerName, playerColor, imageClass, cardType, text: rawText, logId: logEl.id || null, timestamp, rawHtml: ttHtml });
      });
    } else {
      // Fallback: try to find card ids or tt_card_XX patterns in the log HTML
      const outer = logEl.outerHTML || '';
      const idMatch = outer.match(/(?:tt_card_|minicard_|card_)(\d+)/);
      const sourceId = idMatch ? idMatch[1] : null;
      const imageClass = (outer.match(/spl_img_\d+/) || [null])[0];
      const cardType = (outer.match(/type_[A-Za-z]/) || [null])[0];
      events.push({ sourceId, playerName, playerColor, imageClass, cardType, text: rawText, logId: logEl.id || null, timestamp, rawHtml: outer });
    }
  });

  const byPlayer = {};
  events.forEach(ev => {
    const key = ev.playerName || 'Unknown';
    if (!byPlayer[key]) byPlayer[key] = [];
    byPlayer[key].push(ev);
  });

  return { events, byPlayer };
}

function snapshotString(cards) {
  return cards.map(c => (c.id || '') + '|' + (c.text || '')).join(';;');
}

function broadcastReserved(cards) {
  // save to chrome.storage and also notify background
  try {
    chrome.storage.local.set({ reservedCards: cards }, () => {
      // optionally send a message so popup can react immediately
      chrome.runtime.sendMessage({ type: 'reserved-update', cards });
    });
  } catch (e) {
    // runtime may not be available in some contexts
    //console.error(e);
  }
}

function scanAndUpdate() {
  const cards = findReservedCards();
  const snap = snapshotString(cards);
  if (snap !== lastSnapshot) {
    lastSnapshot = snap;
    broadcastReserved(cards);
    // console.log('Reserved tracked', cards);
  }
}

// Initial scan
scanAndUpdate();

// Observe DOM changes to catch updates during the game
const observer = new MutationObserver((mutations) => {
  // Very lightweight: just scan on any mutation
  scanAndUpdate();
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

// Optional: listen for messages from popup to force-scan or adjust selectors
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'force-scan') {
    scanAndUpdate();
    chrome.storage.local.get('reservedCards', (res) => sendResponse({ cards: res.reservedCards || [] }));
    return true; // indicates sendResponse will be called asynchronously
  } else if (msg && msg.type === 'update-selectors' && Array.isArray(msg.selectors)) {
    // replace selectors at runtime
    RESERVED_SELECTORS.length = 0;
    msg.selectors.forEach(s => RESERVED_SELECTORS.push(s));
    scanAndUpdate();
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'capture-reserves') {
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