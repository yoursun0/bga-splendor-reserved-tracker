# BGA Splendor: Opponent Reserved Card Tracker

This is a Chrome extension (Manifest V3) that detects opponent reserved cards on BoardGameArena's Splendor game and displays them in a popup with visual card previews.

## Features

- **Automatic Detection:** Scans the BGA Splendor page for opponent and player reserved cards
- **Visual Previews:** Shows card image type (spl_img_1 through spl_img_6) and color type (type_C, type_S, etc.)
- **Real-time Updates:** Uses MutationObserver to detect DOM changes during gameplay
- **Persistent:** Works throughout the entire game, including game end
- **Customizable Selectors:** Edit CSS selectors at runtime via the popup to adapt to DOM changes

## Installation

1. Clone or download this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** → select this folder
5. The extension will appear in your toolbar

## Usage

1. Open a Splendor game on https://boardgamearena.com/
2. Click the extension icon in your toolbar
3. Click **Refresh** to force a scan for reserved cards
4. Cards will display with:
   - **Card ID** (e.g., `minicard_54`)
   - **Image Preview** (shows card level: 1-6)
   - **Card Type** (e.g., `type_E` for Emerald)
   - **Card Text** (truncated cost details)

## How It Works

- **Content Script** (`content_script.js`): Scans the BGA DOM for reserved card elements using CSS selectors
- **Background Worker** (`background.js`): Persists detected cards to `chrome.storage.local`
- **Popup** (`popup.html`, `popup.js`): Displays cards with visual previews and allows selector customization
- **Styles** (`styles.css`): Provides responsive card layout with image indicators

## Selector Reference

The extension detects reserved cards using these selectors:

```javascript
const RESERVED_SELECTORS = [
  '#player_reserve .spl_card',                    // Player's reserved cards
  '#spl_miniplayerboard .spl_hand [id^="minicard_"]',  // Opponent reserved (left panel)
  '.player-board .spl_hand [id^="minicard_"]',   // Fallback: any player board
  'div[id^="spl_hand_"] [id^="minicard_"]',      // Specific opponent hands
  'div[id^="player_"][id*="reserve"] .spl_card', // Dynamic reserves
];
```

**Key DOM Elements:**
- Opponent reserved cards: `minicard_*` elements (NOT `card_*`)
- Player reserved area: `#player_reserve .spl_card`
- Card visual class: `spl_img_1` to `spl_img_6` (card level)
- Card type class: `type_C`, `type_S`, `type_E`, `type_R`, `type_O`, `type_G` (colors)

## Customizing Selectors

If the extension doesn't detect cards:

1. Open the game and press **F12** to open DevTools
2. Right-click on a reserved card → **Inspect**
3. Note the element structure (ID, classes)
4. Test the selector in the Console: `document.querySelectorAll('YOUR_SELECTOR').length`
5. Paste the working selector into the extension popup's **Selectors** textarea
6. Click **Save Selectors**

## Known Issues & Solutions

- **(a) Missing cards:** Opponent reserved cards are shown as `minicard_*` in `.spl_hand` containers. Ensure selectors target these elements.
- **(b) Cards disappear at game end:** The extension uses persistent opponent player panels that remain in the DOM. If this fails, check if panels are hidden with CSS `display:none`.
- **(c) Visual preview:** Card image type is extracted from the `spl_img_*` class. The popup displays this as a number (1-6) instead of full card art.

## Notes

- This extension respects BoardGameArena's Terms of Service—it only reads visible DOM elements
- The extension stores detected cards in `chrome.storage.local` which persists across tab closes
- Reload the extension in `chrome://extensions` if DOM selectors change after BGA updates
- All files are plain JavaScript/HTML/CSS with no build step—modify and reload to test changes

## Architecture

```
content_script.js → findReservedCards() → extractCardInfo() → RESERVED_SELECTORS
                                              ↓
                                         imageClass, cardType extracted
                                              ↓
                                    chrome.storage.local.set()
                                              ↓
popup.js ← chrome.storage.local.get() ← renderCards() → Display with visual preview
```

## Development

- `manifest.json`: Extension configuration (MV3)
- `content_script.js`: DOM scanning logic with MutationObserver
- `background.js`: Service worker for storage management
- `popup.html/js`: UI for displaying cards and editing selectors
- `styles.css`: Layout and styling for card preview
- `.github/copilot-instructions.md`: Detailed AI-friendly documentation

## License

This project is provided as-is for educational purposes.
