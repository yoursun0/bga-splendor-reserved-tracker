// popup.js - simple reserved cards display
document.addEventListener('DOMContentLoaded', () => {
  const resultsContainer = document.getElementById('captureResults');

  function makePreview(ev) {
    const container = document.createElement('div');
    container.className = 'cardPreview';
    
    // Use local card_XX.png image based on sourceId
    if (ev.sourceId) {
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL(`images/card_${ev.sourceId}.png`);
      img.alt = `card_${ev.sourceId}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      
      // Fallback to '?' if image fails to load
      img.addEventListener('error', () => {
        img.style.display = 'none';
        const fallback = document.createElement('div');
        fallback.style.width = '100%';
        fallback.style.height = '100%';
        fallback.style.display = 'flex';
        fallback.style.alignItems = 'center';
        fallback.style.justifyContent = 'center';
        fallback.textContent = '?';
        fallback.style.fontSize = '16px';
        fallback.style.fontWeight = 'bold';
        fallback.style.color = '#999';
        container.appendChild(fallback);
      });
      
      container.appendChild(img);
      return container;
    }

    // Fallback when no sourceId
    const label = document.createElement('div');
    label.style.width = '100%';
    label.style.height = '100%';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.justifyContent = 'center';
    label.textContent = '?';
    label.style.fontSize = '16px';
    label.style.fontWeight = 'bold';
    label.style.color = '#999';
    container.appendChild(label);
    return container;
  }

  function renderCaptureResults(result) {
    resultsContainer.innerHTML = '';
    if (!result || !result.events || result.events.length === 0) {
      resultsContainer.textContent = '(no reserve events found)';
      return;
    }

    // Render grouped by player
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
        top.textContent = `${idx + 1}. ${ev.sourceId ? 'id:' + ev.sourceId : '(invisible)'}`;
        top.style.fontSize = '12px';
        top.style.fontWeight = '600';
        const sub = document.createElement('div');
        sub.textContent = `${ev.cardType || ''} ${ev.timestamp || ''}`;
        sub.style.fontSize = '11px';
        sub.style.color = '#666';

        meta.appendChild(top);
        meta.appendChild(sub);

        row.appendChild(pv);
        row.appendChild(meta);
        list.appendChild(row);
      });

      section.appendChild(list);
      resultsContainer.appendChild(section);
    });
  }

  function captureReserves() {
    const logSelector = '#logs'; // default selector
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'capture-reserves', logSelector }, (resp) => {
        if (resp && resp.ok && resp.result) {
          renderCaptureResults(resp.result);
        } else {
          resultsContainer.textContent = '(capture failed or no response)';
        }
      });
    });
  }

  // Auto-capture on popup display
  captureReserves();
});