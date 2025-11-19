// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const cardsContainer = document.getElementById('cards');
  const refreshBtn = document.getElementById('refreshBtn');
  const selectorsArea = document.getElementById('selectors');
  const saveSelectors = document.getElementById('saveSelectors');

  function renderCards(cards = []) {
    cardsContainer.innerHTML = '';
    if (cards.length === 0) {
      cardsContainer.textContent = '(no reserved cards detected)';
      return;
    }
    cards.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'cardItem';
      
      // Visual card preview (using imageClass indicator)
      const preview = document.createElement('div');
      preview.className = 'cardPreview';
      if (c.imageClass) {
        preview.textContent = c.imageClass.replace('spl_img_', '');
        preview.title = `Card Type: ${c.cardType || 'unknown'}`;
      } else {
        preview.textContent = '?';
      }
      
      // Card info section
      const info = document.createElement('div');
      info.className = 'cardInfo';
      
      const title = document.createElement('div');
      title.className = 'cardTitle';
      title.textContent = c.id || `Card ${i+1}`;
      
      const typeLabel = document.createElement('div');
      typeLabel.className = 'cardType';
      typeLabel.textContent = c.cardType ? `Type: ${c.cardType}` : '';
      
      const text = document.createElement('div');
      text.className = 'cardText';
      text.textContent = c.text || '(no text)';
      
      info.appendChild(title);
      if (c.cardType) info.appendChild(typeLabel);
      info.appendChild(text);
      
      d.appendChild(preview);
      d.appendChild(info);
      cardsContainer.appendChild(d);
    });
  }

  refreshBtn.addEventListener('click', () => {
    // Tell the content script to force a scan
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'force-scan' }, (resp) => {
        // the content script will respond with latest cards via sendResponse
        if (resp && resp.cards) renderCards(resp.cards);
        else {
          // fallback to storage
          chrome.storage.local.get('reservedCards', (res) => renderCards(res.reservedCards || []));
        }
      });
    });
  });

  saveSelectors.addEventListener('click', () => {
    const selectors = selectorsArea.value.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'update-selectors', selectors }, (resp) => {
        console.log('selectors update resp', resp);
      });
    });
  });

  // Load selectors from storage (if previously saved)
  chrome.storage.local.get(['reservedSelectors', 'reservedCards'], (res) => {
    if (res.reservedSelectors) selectorsArea.value = res.reservedSelectors.join('\n');
    renderCards(res.reservedCards || []);
  });

  // Save selectors when changed (auto)
  selectorsArea.addEventListener('change', () => {
    const selectors = selectorsArea.value.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.storage.local.set({ reservedSelectors: selectors });
  });
});