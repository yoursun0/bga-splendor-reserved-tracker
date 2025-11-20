#!/usr/bin/env node
const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.resolve(ROOT_DIR, 'images');

function startServer() {
  const app = express();
  app.use(express.static(ROOT_DIR));
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`[cleanup] static server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

function isCardFile(filename) {
  return /^card_\d+\.png$/.test(filename);
}

async function getImageSizeInBrowser(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  const size = await page.evaluate(() => {
    const img = document.querySelector('img') || document.querySelector('body');
    if (img && img.naturalWidth) {
      return { w: img.naturalWidth, h: img.naturalHeight };
    }
    // fallback: measure body
    return { w: document.body.clientWidth, h: document.body.clientHeight };
  });
  await page.close();
  return size;
}

(async () => {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('[cleanup] images directory not found:', IMAGES_DIR);
    process.exit(1);
  }

  const server = await startServer();
  const browser = await puppeteer.launch({ headless: true });

  try {
    // Gather image files
    const files = fs.readdirSync(IMAGES_DIR).filter(f => f.toLowerCase().endsWith('.png'));

    if (!files.length) {
      console.log('[cleanup] No PNG files found in images/');
      await browser.close();
      server.close();
      return;
    }

    // Determine reference size: prefer card_84.png if exists, otherwise pick the largest image
    let referenceFile = 'card_84.png';
    if (!files.includes(referenceFile)) {
      // pick largest file by file size as heuristic
      referenceFile = files.slice().sort((a, b) => fs.statSync(path.join(IMAGES_DIR, b)).size - fs.statSync(path.join(IMAGES_DIR, a)).size)[0];
      console.warn('[cleanup] card_84.png not found; using', referenceFile, 'as reference (heuristic)');
    } else {
      console.log('[cleanup] Using card_84.png as reference size');
    }

    const referenceUrl = `http://localhost:${PORT}/images/${referenceFile}`;
    const refSize = await getImageSizeInBrowser(browser, referenceUrl);
    console.log('[cleanup] Reference file', referenceFile, 'size:', refSize);

    const tolerance = 0.25; // 25% tolerance
    let deleted = 0;

    for (const f of files) {
      const filePath = path.join(IMAGES_DIR, f);

      // Only card_NNN.png allowed
      if (!isCardFile(f)) {
        console.log('[cleanup] Deleting non-matching filename:', f);
        fs.unlinkSync(filePath);
        deleted++;
        continue;
      }

      // Check image size
      const url = `http://localhost:${PORT}/images/${f}`;
      let size;
      try {
        size = await getImageSizeInBrowser(browser, url);
      } catch (err) {
        console.warn('[cleanup] Failed to load image', f, err.message || err);
        // delete if cannot be loaded
        fs.unlinkSync(filePath);
        deleted++;
        continue;
      }

      const widthOk = Math.abs(size.w - refSize.w) / refSize.w <= tolerance;
      const heightOk = Math.abs(size.h - refSize.h) / refSize.h <= tolerance;

      if (!widthOk || !heightOk) {
        console.log(`[cleanup] Deleting ${f} due to size mismatch (${size.w}x${size.h})`);
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    console.log(`[cleanup] Done. Deleted ${deleted} files.`);
  } finally {
    await browser.close();
    server.close();
  }
})();
