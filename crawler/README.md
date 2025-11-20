# BGA Card Crawler

This is a small helper to automate capturing `card_xx.png` from local sample HTML files or from live pages (replays).

How it works:
- Starts a tiny static server that serves the repository so local HTML like `resources/sample_dom.html` are accessible via `http://localhost:3000/...`.
- Launches Puppeteer, navigates to each target URL, finds elements with IDs like `card_<num>` or tooltip elements with `data-id`, and screenshots the matched element to `images/card_<id>.png`.

Setup (Windows / PowerShell):

```powershell
cd crawler
npm install
```

Run (captures from samples by default):

```powershell
npm start
```

Custom targets:
- Provide URLs as CLI args:

```powershell
node crawl.js "https://boardgamearena.com/....replay..." "http://localhost:3000/resources/sample2.html"
```

- Or create `crawler/targets.txt` with one URL per line and run `node crawl.js`.

Notes and caveats:
- For live BGA replays you may need to be logged in and Puppeteer to run a non-headless browser with your credentials, or provide cookie/session handling. This script does not perform authentication.
- The script focuses on elements with IDs starting `card_`, elements with `data-id`, and images with `minicard` classes. You can extend the selector list in `crawl.js` if needed.
- Output images are saved to the repository `images/` directory as `card_<id>.png`.

Cleanup utility:
- A helper `cleanup.js` is provided to remove incorrectly captured images. It deletes files that don't match the exact filename pattern `card_<number>.png` and images whose dimensions differ significantly from the reference image (prefer `card_84.png` as reference).

Usage (delete bad images):

```powershell
cd crawler
npm run cleanup
```

 
 History-driven crawling:
 - Create `crawler/history.txt` and list one or more BGA history page URLs (one per line). The crawler will visit each history page, extract all `a.bga-link` game links, open each game's review (`a.bgabutton_gray`), and iterate every `a.choosePlayerLink` to load the player's board and capture cards.
 
 Example `history.txt` contents:
 
 ```
 https://boardgamearena.com/player/yourusername/history
 ```
 
 Run history mode:
 
 ```powershell
 cd crawler
 node crawl.js
 ```
 
By default the crawler will overwrite captured `images/card_<id>.png`. To skip overwriting already-existing files, pass the `--no-overwrite` flag:

```powershell
node crawl.js --no-overwrite
```

Interactive mode (for authenticated BGA pages):
- To crawl authenticated/private BGA replay pages, launch the crawler with `--interactive` to open a visible browser window. You will then have time to log into BGA before the crawler starts:

```powershell
node crawl.js --interactive
```

- The crawler will wait 5 seconds for you to manually log in (or finish any setup), then begin crawling.
- Combine with `--no-overwrite` if desired:

```powershell
node crawl.js --interactive --no-overwrite
```If you want, I can extend the script to:
- Accept a CSV of replay links and crawl them in parallel.
- Use a non-headless browser and load a cookies file for authenticated scraping.
- Add retries and more robust waiting for dynamic content.
