# BGA Splendor: Opponent Reserved Tracker (starter)

This is a minimal Chrome extension skeleton to help you experiment with tracking reserved cards on BoardGameArena's Splendor game.

Quick steps:
1. Create a folder and add these files from this repo.
2. Open Chrome -> chrome://extensions -> enable Developer mode -> Load unpacked -> select the folder.
3. Open a Splendor game on https://boardgamearena.com.
4. Click the extension toolbar icon. Use "Refresh" to force a scan.
5. Open DevTools on the game page and inspect how reserved cards are represented. Edit content_script.js RESERVED_SELECTORS to match real selectors and reload the extension.

Notes:
- BoardGameArena's DOM/internals change over time. Use DevTools to find CSS selectors, data attributes, or JS variables that indicate a card is reserved.
- If the UI is rendered on canvas or via WebSockets without DOM nodes representing cards, you'll need to inspect network frames or hook into the game's JS objects. That is more advanced.
- Be mindful of BoardGameArena's Terms of Service; do not use this to cheat.
- This starter stores a snapshot in chrome.storage.local and broadcasts updates; the popup reads from storage.

Happy hacking!