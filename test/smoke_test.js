const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async function run() {
  try {
    const htmlPath = path.resolve(__dirname, '..', 'resources', 'sample3.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Remove external remote scripts and any inline scripts to avoid running BGA production scripts in JSDOM
    let cleanedHtml = html.replace(/<script[^>]+src=["']https?:[^"']+["'][^>]*><\/script>/gi, '');
    // Also remove any remaining inline <script>...</script> blocks
    cleanedHtml = cleanedHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

    const dom = new JSDOM(cleanedHtml, {
      runScripts: 'dangerously',
      resources: 'usable',
      // Provide small shims before any script execution to avoid runtime errors
      beforeParse(window) {
        // Minimal AMD/RequireJS/Dojo shim
        try {
          window.define = function () { /* noop */ };
          window.define.amd = true;
        } catch (e) { /* ignore */ }

        // matchMedia shim
        try {
          window.matchMedia = window.matchMedia || function () {
            return { matches: false, addListener: function () {}, removeListener: function () {} };
          };
        } catch (e) { /* ignore */ }
      }
    });
    const { window } = dom;
    const { document } = window;

    // stub chrome.runtime.getURL to return the path (so src contains 'images/card_')
    window.chrome = {
      runtime: {
        getURL: (p) => p
      },
      storage: {
        local: {
          get: (defaults, cb) => cb(defaults),
          set: (obj, cb) => cb && cb()
        }
      },
      runtime_onMessage_callbacks: [],
      runtime: {
        onMessage: {
          addListener: (fn) => { window.chrome.runtime_onMessage_callbacks.push(fn); }
        }
      }
    };

    // Load content_script.js into the jsdom window context
    const csPath = path.resolve(__dirname, '..', 'content_script.js');
    const csCode = fs.readFileSync(csPath, 'utf8');

    // Evaluate the content script inside the JSDOM window
    // Expose console to window for logs
    window.console = console;
    window.setTimeout = setTimeout;
    window.setInterval = setInterval;
    window.clearInterval = clearInterval;

    // Evaluate
    window.eval(csCode);

    // Now simulate enabling autoReveal via storage by sending the runtime message
    // The content script listens to chrome.storage at load; storage stub returned default false.
    // We'll trigger the runtime message to enable it.
    const enableMsg = { type: 'auto-reveal-set', enabled: true };
    // find any registered listeners (our stub stored them)
    const listeners = window.chrome.runtime_onMessage_callbacks || [];
    for (const l of listeners) {
      try { l(enableMsg, null, (resp) => {}); } catch (e) { /*ignore*/ }
    }

    // Wait a bit for intervals to run
    await new Promise(res => setTimeout(res, 1200));

    // Inspect generated hands
    const hands = Array.from(document.querySelectorAll('div.spl_hand'));
    let totalGen = 0;
    const report = [];
    hands.forEach(hand => {
      const images = Array.from(hand.querySelectorAll('img'));
      if (images.length) totalGen += images.length;
      report.push({ id: hand.id, imgs: images.map(i => i.getAttribute('src')) });
    });

    console.log('SMOKE TEST RESULT: total hands:', hands.length, 'total generated imgs found:', totalGen);
    report.forEach(r => console.log('HAND', r.id, 'imgs:', r.imgs));

    // Save the modified DOM to tmp for inspection
    const outPath = path.resolve(__dirname, 'smoke_out.html');
    fs.writeFileSync(outPath, dom.serialize(), 'utf8');
    console.log('Wrote modified DOM to', outPath);

    // Exit
    process.exit(totalGen > 0 ? 0 : 2);
  } catch (e) {
    console.error('SMOKE TEST ERROR', e);
    process.exit(3);
  }
})();
