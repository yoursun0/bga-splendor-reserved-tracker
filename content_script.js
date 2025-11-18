// content_script.js
// Minimal heuristic scanning + MutationObserver to detect "reserved" cards.
// NOTE: BoardGameArena's real DOM/classes may differ; open DevTools and adapt RESERVED_SELECTORS.

const RESERVED_SELECTORS = [
  // BGA Splendor selectors (adapted from live DOM analysis)
  '#player_reserve .spl_card',           // Cards in player's reserved area
  '#spl_playertable [id^="player_reserved_card"]', // Reserved card ID pattern
  'div[id^="player_"][id*="reserve"] .spl_card', // Dynamic reserved card selectors
];

let lastSnapshot = '';

function extractCardInfo(el) {
  // Try to gather useful info that will help you identify the card
  const id = el.dataset.cardId || el.id || el.getAttribute('data-card-id') || null;
  const text = (el.innerText || '').trim().slice(0, 200);
  const html = el.outerHTML;
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect().toJSON() : {};
  return { id, text, html, rect };
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

  return Array.from(found.values());
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
  }
});