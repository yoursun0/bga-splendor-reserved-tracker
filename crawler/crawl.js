#!/usr/bin/env node
const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Config
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT_DIR, 'images');

// Default targets (serve local sample files)
const DEFAULT_TARGETS = [
  `http://localhost:${PORT}/resources/sample_dom.html`,
  `http://localhost:${PORT}/resources/sample2.html`
];

const HISTORY_FILE = path.resolve(__dirname, 'history.txt');

async function ensureOutDir() {
  try {
    await fs.promises.mkdir(OUT_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create images dir', err);
    process.exit(1);
  }
}

function startServer() {
  const app = express();
  app.use(express.static(ROOT_DIR));

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[crawler] static server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

function sanitizeId(id) {
  // Remove non-word chars
  return String(id).replace(/[^0-9a-zA-Z_-]/g, '_');
}

async function run(targets, options = {}) {
  await ensureOutDir();

  const server = await startServer();

  // If --interactive flag is set, launch in non-headless mode to allow manual login
  const headless = options.interactive ? false : true;
  if (options.interactive) {
    console.log('[crawler] Launching in interactive mode (headless: false) — you can manually log in to BGA');
  }
  const browser = await puppeteer.launch({ headless });
  const page = await browser.newPage();

  // For interactive mode, optionally wait a bit before starting crawl to allow login
  if (options.interactive) {
    console.log('[crawler] Waiting 30 seconds before starting crawl (use this time to log in if needed)...');
    await new Promise(r => setTimeout(r, 30000));
  }

  // Avoid timeouts for slow pages
  await page.setDefaultNavigationTimeout(60_000);

  const seen = new Set();

  // cross-version sleep helper (some Puppeteer versions lack page.waitForTimeout)
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // helper to get image natural size via a browser page
  async function getImageSizeInBrowser(browser, url) {
    const p = await browser.newPage();
    await p.goto(url, { waitUntil: 'networkidle2' });
    const size = await p.evaluate(() => {
      const img = document.querySelector('img') || document.querySelector('body');
      if (img && img.naturalWidth) {
        return { w: img.naturalWidth, h: img.naturalHeight };
      }
      return { w: document.body.clientWidth, h: document.body.clientHeight };
    });
    await p.close();
    return size;
  }

  // Determine reference size (prefer card_84.png)
  let refSize = null;
  try {
    const refFile = 'card_84.png';
    const refPath = path.join(OUT_DIR, refFile);
    if (fs.existsSync(refPath)) {
      const refUrl = `http://localhost:${PORT}/images/${refFile}`;
      refSize = await getImageSizeInBrowser(browser, refUrl);
      console.log('[crawler] Reference size from', refFile, refSize);
    } else {
      // fallback default (reasonable card thumbnail size)
      refSize = { w: 200, h: 300 };
      console.warn('[crawler] Reference file card_84.png not found — using default refSize', refSize);
    }
  } catch (err) {
    console.warn('[crawler] failed to determine reference size, using default', err.message || err);
    refSize = { w: 200, h: 300 };
  }
  const TOLERANCE = 0.30; // 30% tolerance

  // If a history.txt exists in crawler/, use it as the source of history pages (then stop)
  if (fs.existsSync(HISTORY_FILE)) {
    const historyTargets = readTargetsFile(HISTORY_FILE) || [];
    if (historyTargets.length) {
      console.log('[crawler] Found history.txt with', historyTargets.length, 'entries — processing history pages');
      const noOverwrite = process.argv.includes('--no-overwrite');
      for (const historyUrl of historyTargets) {
        try {
          console.log('[crawler] Visiting history page', historyUrl);
          await page.goto(historyUrl, { waitUntil: 'networkidle2' });
          await sleep(800);
          
          const links = await page.$$eval('a.table_name.bga-link.smalltext', els => els.map(a => a.href).filter(Boolean)).catch(() => []);
          console.log('[crawler] Found', links.length, 'game links on history page');
          for (const gameHrefRaw of links) {
            const gameHref = new URL(gameHrefRaw, historyUrl).href;
            await processGamePage(gameHref, page, browser, seen, refSize, TOLERANCE, noOverwrite);
          }
        } catch (err) {
          console.error('[crawler] failed to process history page', historyUrl, err.message || err);
        }
      }
      // done with history mode; close and exit
      await browser.close();
      server.close();
      console.log('[crawler] Done. Captured', seen.size, 'cards. Files saved to', OUT_DIR);
      return;
    }
  }

  // helper to process a single player view (page already loaded for the player)
  async function captureFromPlayerView(page, browser, seen, refSize, TOLERANCE, noOverwrite) {
    // Gather candidate elements and their ids (prefer elements with id starting card_)
    const elements = await page.$$('[id^="card_"]');

    console.log(`[crawler] Found ${elements.length} candidate elements on player page`);

    for (const el of elements) {
      try {
        const info = await page.evaluate((node) => {
          const out = { id: null, rect: null };
          if (node.id && node.id.match(/^card_\d+/)) {
            out.id = node.id.replace(/^card_/, '');
          }
          if (!out.id && node.dataset && node.dataset.id) {
            out.id = node.dataset.id;
          }
          if (!out.id && node.getAttribute) {
            const html = node.outerHTML || '';
            const m = html.match(/tt_card_(\d+)/) || html.match(/card_(\d+)/) || html.match(/minicard_(\d+)/);
            if (m) out.id = m[1];
          }
          const r = node.getBoundingClientRect();
          out.rect = { x: r.x, y: r.y, width: r.width, height: r.height };
          return out;
        }, el);

        if (!info || !info.id) continue;
        if (!/^\d+$/.test(String(info.id))) continue;

        const cardId = sanitizeId(info.id);
        const filename = `card_${cardId}.png`;
        const outPath = path.join(OUT_DIR, filename);

        if (noOverwrite && fs.existsSync(outPath)) continue;
        if (seen.has(cardId) && noOverwrite) continue;

        // validate bounding box
        const rect = info.rect || { width: 0, height: 0 };
        const widthOk = Math.abs(rect.width - refSize.w) / refSize.w <= TOLERANCE;
        const heightOk = Math.abs(rect.height - refSize.h) / refSize.h <= TOLERANCE;
        if (!widthOk || !heightOk) {
          console.log(`[crawler] Skipping ${filename} — bounding box ${rect.width}x${rect.height} not within tolerance of ${refSize.w}x${refSize.h}`);
          continue;
        }

        await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }));
        await sleep(120);
        await el.screenshot({ path: outPath });
        console.log(`[crawler] Saved ${filename}`);
        seen.add(cardId);
      } catch (err) {
        console.warn('[crawler] element capture failed:', err.message || err);
      }
    }
  }

  // process one game review page: open review link, iterate players and capture
  async function processGamePage(gameUrl, page, browser, seen, refSize, TOLERANCE, noOverwrite) {
    try {
      await page.goto(gameUrl, { waitUntil: 'networkidle2' });
      await sleep(3000);
      const reviewHref = await page.$eval('a#reviewgame', a => a.href).catch(() => null);
      if (!reviewHref) {
        console.log('[crawler] No review link on', gameUrl);
        return;
      }
      const reviewUrl = new URL(reviewHref, page.url()).href;
      console.log('[crawler] Opening review', reviewUrl);
      await page.goto(reviewUrl, { waitUntil: 'networkidle2' });
      await sleep(3000);

      const playerLinks = await page.$$eval('a.choosePlayerLink', els => els.map(a => a.href).filter(Boolean)).catch(() => []);
      if (!playerLinks.length) {
        console.log('[crawler] No player links found on review page', reviewUrl);
        return;
      }

      for (const playerHrefRaw of playerLinks) {
        const playerHref = new URL(playerHrefRaw, page.url()).href;
        console.log('[crawler] Choosing player', playerHref);
        await page.goto(playerHref, { waitUntil: 'networkidle2' });
        // wait 4 seconds to allow board to render
        await sleep(4000);
        await captureFromPlayerView(page, browser, seen, refSize, TOLERANCE, noOverwrite);
      }
    } catch (err) {
      console.error('[crawler] failed to process game page', gameUrl, err.message || err);
    }
  }

  for (const target of targets) {
    console.log(`[crawler] Visiting ${target}`);
    try {
    await page.goto(target, { waitUntil: 'networkidle2' });
    await sleep(800); // small delay for any client-side rendering

      // Gather candidate elements and their ids
      const elements = await page.$$('[id^="card_"] , .spl_notif-inner-tooltip[data-id] , img.minicard, .minicard, .card, [data-id]');

      console.log(`[crawler] Found ${elements.length} candidate elements on page`);

      for (const el of elements) {
        try {
          const info = await page.evaluate((node) => {
            const out = { id: null, rect: null };
            if (node.id && node.id.match(/^card_\d+/)) {
              out.id = node.id.replace(/^card_/, '');
            }
            if (!out.id && node.dataset && node.dataset.id) {
              out.id = node.dataset.id;
            }
            if (!out.id && node.getAttribute) {
              // try to find any tt_card_ or card_XX in outerHTML
              const html = node.outerHTML || '';
              const m = html.match(/tt_card_(\d+)/) || html.match(/card_(\d+)/) || html.match(/minicard_(\d+)/);
              if (m) out.id = m[1];
            }
            // bounding rect
            const r = node.getBoundingClientRect();
            out.rect = { x: r.x, y: r.y, width: r.width, height: r.height };
            return out;
          }, el);

          if (!info || !info.id) {
            // skip elements we couldn't find an id for
            continue;
          }

          // only accept pure-integer ids
          if (!/^\d+$/.test(String(info.id))) {
            // skip non-integer ids like card_83_R or similar
            continue;
          }

          const cardId = sanitizeId(info.id);
          const filename = `card_${cardId}.png`;
          const outPath = path.join(OUT_DIR, filename);

          if (seen.has(cardId)) {
            // already captured
            continue;
          }

          // validate bounding box size before screenshot
          const rect = info.rect || { width: 0, height: 0 };
          const widthOk = Math.abs(rect.width - refSize.w) / refSize.w <= TOLERANCE;
          const heightOk = Math.abs(rect.height - refSize.h) / refSize.h <= TOLERANCE;
          if (!widthOk || !heightOk) {
            console.log(`[crawler] Skipping ${filename} — bounding box ${rect.width}x${rect.height} not within tolerance of ${refSize.w}x${refSize.h}`);
            continue;
          }

          // Try to make element visible
          await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }));
          await sleep(120);

          // Screenshot element
          await el.screenshot({ path: outPath });
          console.log(`[crawler] Saved ${filename}`);
          seen.add(cardId);
        } catch (innerErr) {
          console.warn('[crawler] element capture failed:', innerErr.message || innerErr);
          continue;
        }
      }

    } catch (err) {
      console.error(`[crawler] failed to visit ${target}:`, err.message || err);
    }
  }

  await browser.close();
  server.close();

  console.log('[crawler] Done. Captured', seen.size, 'cards. Files saved to', OUT_DIR);
}

function readTargetsFile(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    return txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch (err) {
    return null;
  }
}

(async () => {
  // targets can be supplied as CLI args: node crawl.js url1 url2
  const interactive = process.argv.includes('--interactive');
  const noOverwrite = process.argv.includes('--no-overwrite');
  const argvTargets = process.argv.slice(2).filter(a => !a.startsWith('--'));

  let targets = [];

  if (argvTargets.length) {
    targets = argvTargets;
  } else {
    const fileTargets = readTargetsFile(path.resolve(__dirname, 'targets.txt'));
    if (fileTargets) targets = fileTargets;
  }

  if (!targets.length) {
    targets = DEFAULT_TARGETS;
  }

  await run(targets, { interactive, noOverwrite });
})();
