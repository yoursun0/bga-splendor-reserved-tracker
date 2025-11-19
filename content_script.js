// content_script.js
// Log-based reserved card tracking for BoardGameArena Splendor.
// Extracts reserve events from the game log (NOT from DOM selectors).
// Only the captureReserveLogs function is active; old RESERVED_SELECTORS approach is deprecated.

// Toggle verbose console debugging
const DEBUG = true;


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

  logEls.forEach(logEl => {
    const rawText = (logEl.innerText || '').trim();
    if (DEBUG) console.log('[bga-reserved] captureReserveLogs: processing log', logEl.id || '(no id)', 'text', rawText.slice(0,120));
    if (!reserveRe.test(rawText)) {
      if (DEBUG) console.log('[bga-reserved] captureReserveLogs: skipping non-reserve log', logEl.id || '(no id)');
      return; // skip non-reserve logs
    }

    const playerSpan = logEl.querySelector('.playername');
    const playerName = playerSpan ? playerSpan.textContent.trim() : 'Unknown';
    const playerColor = playerSpan ? (playerSpan.style && playerSpan.style.color) || getComputedStyle(playerSpan).color : null;
    const timestampEl = logEl.querySelector('.timestamp');
    const timestamp = timestampEl ? timestampEl.textContent.trim() : null;

    // Find tooltip nodes (explicit card mentions)
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
        events.push({ sourceId, playerName, playerColor, imageClass, cardType, imageUrl, text: rawText, logId: logEl.id || null, timestamp, rawHtml: ttHtml });
      });
    } else {
      // Fallback: try to find card ids or tt_card_XX patterns in the log HTML
      const outer = logEl.outerHTML || '';
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
      events.push({ sourceId, playerName, playerColor, imageClass, cardType, imageUrl, text: rawText, logId: logEl.id || null, timestamp, rawHtml: outer });
    }
  });

  const byPlayer = {};
  events.forEach(ev => {
    const key = ev.playerName || 'Unknown';
    if (!byPlayer[key]) byPlayer[key] = [];
    byPlayer[key].push(ev);
  });

  if (DEBUG) console.log('[bga-reserved] captureReserveLogs: finished capture, events:', events.length);

  return { events, byPlayer };
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