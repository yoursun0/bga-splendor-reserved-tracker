// popup.js - simple reserved cards display
document.addEventListener('DOMContentLoaded', () => {
  const resultsContainer = document.getElementById('captureResults');
  const autoToggle = document.getElementById('autoRevealToggle');

  // initialize toggle state from storage
  if (autoToggle) {
    try {
      chrome.storage.local.get({ autoRevealEnabled: false }, (vals) => {
        autoToggle.checked = !!vals.autoRevealEnabled;
      });

      autoToggle.addEventListener('change', () => {
        const enabled = !!autoToggle.checked;
        chrome.storage.local.set({ autoRevealEnabled: enabled }, () => {
          // notify content scripts to toggle immediately
          chrome.runtime.sendMessage({ type: 'auto-reveal-set', enabled });
        });
      });
    } catch (e) {
      // In case chrome.storage isn't available (tests), ignore
    }
  }

  function makePreview(ev) {
    const container = document.createElement('div');
    container.className = 'cardPreview';
    
    // Use local card_XX.png image based on sourceId, or card_cover_X.png for hidden cards
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
    
    // Hidden card: use card_cover_X.png based on row
    if (ev.isHidden && ev.row) {
      const img = document.createElement('img');
      img.src = chrome.runtime.getURL(`images/card_cover_${ev.row}.png`);
      img.alt = `hidden_card_row_${ev.row}`;
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

    // Fallback when no sourceId and no hidden card info
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
      section.dataset.player = player;
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
        // annotate for later matching when a buy event arrives
        if (ev.sourceId) row.dataset.cardId = ev.sourceId;
        if (ev.row) row.dataset.rownum = String(ev.row);
        if (ev.color) row.dataset.colorname = ev.color;

        const pv = makePreview(ev);
        pv.title = `${ev.cardType || ''} ${ev.sourceId || ''}`;

        const meta = document.createElement('div');
        meta.style.flex = '1';
        const rowLabel = ev.row ? `| row : ${ev.row}` : '';
        const colorLabel = ev.color ? `| color: ${ev.color}` : (ev.cardType || '');
        
        const top = document.createElement('div');
        const cardLabel = ev.isHidden ? `(hidden)` : (ev.sourceId ? 'id:' + ev.sourceId : '(invisible)');
        top.textContent = `${idx + 1}. ${cardLabel} ${rowLabel} ${colorLabel}`;
        top.style.fontSize = '12px';
        top.style.fontWeight = '600';

        const sub = document.createElement('div');
        sub.textContent = `${ev.timestamp || ''}`;
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

    // Process buys (remove matching reserved card entries)
    const buys = result.buys || [];
    if (buys.length) {
      buys.forEach(b => {
        const player = b.playerName || 'Unknown';
        // find player's section
        const playerSection = Array.from(resultsContainer.querySelectorAll('div')).find(d => d.dataset && d.dataset.player === player);
        if (!playerSection) return;
        
        // First, try to find a matching visible card with same rowNum and colorName
        const candidates = Array.from(playerSection.querySelectorAll('[data-rownum][data-colorname]'));
        const match = candidates.find(c => c.dataset.rownum === (b.rowNum ? String(b.rowNum) : '') && c.dataset.colorname === (b.colorName || ''));
        if (match) {
          match.remove();
          return; // found and removed visible card, we're done
        }
        
        // If no visible card matched, check for a hidden card with matching row number
        // Hidden cards are shown with (invisible) label and have data-rownum but no data-colorname
        const hiddenCandidates = Array.from(playerSection.querySelectorAll('[data-rownum]:not([data-colorname]'));
        const hiddenMatch = hiddenCandidates.find(c => c.dataset.rownum === (b.rowNum ? String(b.rowNum) : ''));
        if (hiddenMatch) {
          hiddenMatch.remove(); // remove the hidden card that was bought
        }
      });
    }
  }

  function captureReserves() {
    const logSelector = '#logs'; // default selector
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'capture-reserves', logSelector }, (resp) => {
        if (resp && resp.ok && resp.result) {
          renderCaptureResults(resp.result);
        } else {
          resultsContainer.textContent = 'no cards are reserved yet';
        }
      });
    });
  }

  // Auto-capture on popup display
  captureReserves();
});