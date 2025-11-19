// popup.js - interactive debug popup
document.addEventListener('DOMContentLoaded', () => {
  const captureBtn = document.getElementById('captureBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearResults');
  const logSelectorInput = document.getElementById('logSelector');
  const resultsContainer = document.getElementById('captureResults');
  const selectorsArea = document.getElementById('selectors');
  const saveSelectors = document.getElementById('saveSelectors');

  function makePreview(ev) {
    const el = document.createElement('div');
    el.className = 'cardPreview';
    const label = ev.imageClass ? ev.imageClass.replace('spl_img_', '') : '?';
    el.textContent = label;
    // color by type
    const colorMap = { type_C: '#F6EFD6', type_S: '#D6E9F6', type_E: '#DFF6E1', type_R: '#F6D6D6', type_O: '#FAE7C8', type_G: '#FFF0B3' };
    if (ev.cardType && colorMap[ev.cardType]) el.style.backgroundColor = colorMap[ev.cardType];
    return el;
  }

  function renderCaptureResults(result) {
    resultsContainer.innerHTML = '';
    if (!result || !result.events || result.events.length === 0) {
      resultsContainer.textContent = '(no reserve events found)';
      return;
    }

    // Render grouped by player first
    const byPlayer = result.byPlayer || {};
    Object.keys(byPlayer).forEach(player => {
      const section = document.createElement('div');
      section.style.borderBottom = '1px solid #eee';
      section.style.padding = '6px 0';

      const heading = document.createElement('div');
      heading.style.fontWeight = '700';
      heading.style.marginBottom = '6px';
      heading.textContent = player;
      section.appendChild(heading);

      const list = document.createElement('div');
      byPlayer[player].forEach((ev, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '6px';

        const pv = makePreview(ev);
        pv.title = `${ev.cardType || ''} ${ev.sourceId || ''}`;

        const meta = document.createElement('div');
        meta.style.flex = '1';
        const top = document.createElement('div');
        top.textContent = `${idx + 1}. ${ev.sourceId ? 'id:' + ev.sourceId : (ev.text || '').slice(0, 50)}`;
        top.style.fontSize = '12px';
        top.style.fontWeight = '600';
        const sub = document.createElement('div');
        sub.textContent = `${ev.cardType || ''} ${ev.timestamp || ''}`;
        sub.style.fontSize = '11px';
        sub.style.color = '#666';

        meta.appendChild(top);
        meta.appendChild(sub);

        const inspect = document.createElement('button');
        inspect.textContent = 'Inspect';
        inspect.style.fontSize = '11px';
        inspect.addEventListener('click', () => {
          // toggle rawHtml display
          if (row._raw) {
            row.removeChild(row._raw);
            row._raw = null;
          } else {
            const raw = document.createElement('pre');
            raw.style.fontSize = '10px';
            raw.style.maxHeight = '160px';
            raw.style.overflow = 'auto';
            raw.textContent = ev.rawHtml || ev.text || '';
            row.appendChild(raw);
            row._raw = raw;
          }
        });

        row.appendChild(pv);
        row.appendChild(meta);
        row.appendChild(inspect);
        list.appendChild(row);
      });

      section.appendChild(list);
      resultsContainer.appendChild(section);
    });
  }

  captureBtn.addEventListener('click', () => {
    const selector = (logSelectorInput.value || '').trim() || '#logs';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'capture-reserves', logSelector: selector }, (resp) => {
        if (resp && resp.ok && resp.result) {
          renderCaptureResults(resp.result);
        } else {
          resultsContainer.textContent = '(capture failed or no response)';
        }
      });
    });
  });

  refreshBtn.addEventListener('click', () => {
    // Ask content script to return the latest reserved snapshot
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'force-scan' }, (resp) => {
        if (resp && resp.cards) {
          // convert cards into a faux result with single 'Unknown' player
          renderCaptureResults({ events: resp.cards, byPlayer: { 'Detected': resp.cards } });
        } else {
          chrome.storage.local.get('reservedCards', (res) => {
            const cards = res.reservedCards || [];
            renderCaptureResults({ events: cards, byPlayer: { 'Detected': cards } });
          });
        }
      });
    });
  });

  clearBtn.addEventListener('click', () => { resultsContainer.innerHTML = ''; });

  saveSelectors.addEventListener('click', () => {
    const selectors = selectorsArea.value.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'update-selectors', selectors }, (resp) => {
        console.log('selectors update resp', resp);
      });
    });
  });

  // Load selectors from storage
  chrome.storage.local.get(['reservedSelectors', 'reservedCards'], (res) => {
    if (res.reservedSelectors) selectorsArea.value = res.reservedSelectors.join('\n');
    // show saved snapshot if any
    if (res.reservedCards && res.reservedCards.length) renderCaptureResults({ events: res.reservedCards, byPlayer: { 'Saved Snapshot': res.reservedCards } });
  });

  selectorsArea.addEventListener('change', () => {
    const selectors = selectorsArea.value.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.storage.local.set({ reservedSelectors: selectors });
  });
});