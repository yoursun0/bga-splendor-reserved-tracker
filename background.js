// background.js (service worker for MV3)
// Keep a copy of latest reserved cards in storage so popup can read quickly

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'reserved-update') {
    chrome.storage.local.set({ reservedCards: msg.cards });
  }
});