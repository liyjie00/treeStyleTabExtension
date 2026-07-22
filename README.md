# Tree Style Tabs (Chrome)

A Chrome extension inspired by Firefox's [Tree Style Tab](https://addons.mozilla.org/en-US/firefox/addon/tree-style-tab/): tabs opened from a link on another tab are nested under their opener, tree-style, in a dedicated panel.

Chrome's native side panel enforces a fixed minimum width (~320px) with no API to override it, so instead of relying on it exclusively, this extension docks a regular popup window against the browser window it's tracking — shrinking/shifting the browser window to make room, following it on move/resize, and re-shrinking it if it gets maximized. `chrome.sidePanel` is still used as a fallback for macOS fullscreen, where a separate popup window can't appear alongside the browser window at all (fullscreen moves it to its own Space) — see [Architecture](#architecture).

## Features

- Automatic tree structure from `openerTabId` — no manual setup
- Collapse/expand branches
- Drag tabs (and their whole subtree) to reparent/reorder them in the tree, or drop below the list to promote one to a root tab
- Dockable panel window (left or right side, toggle in the header) that follows the browser window it's attached to
- Drag the panel's own edge to resize it — the browser window adjusts to match, and the setting persists across restarts
- Works in macOS fullscreen via a `chrome.sidePanel` fallback (toolbar icon click switches automatically based on the window's fullscreen state)
- Reopens itself automatically next time the browser starts, if it was left open
- Hover a tab row to reveal a close (×) button; a pinned "+" button opens a new tab
- Search box that highlights matching tabs by title/URL and auto-expands collapsed ancestors to keep matches reachable

## Development

```bash
npm install
npm run build     # outputs to dist/
npm run dev        # rebuild on file changes
```

Then in `chrome://extensions`:
1. Enable **Developer mode**
2. **Load unpacked** → select the `dist/` directory
3. Click the toolbar icon to open the panel

Reloading the extension from `chrome://extensions` will make any currently-open panel window flash to a blank New Tab page — that's Chrome tearing down the extension's old resources, not a bug here. Clicking the toolbar icon again re-navigates it back to the panel automatically.

## Architecture

- `src/background/` — the service worker.
  - `tree.ts` — pure tree operations (add/remove/reparent/move/collapse), keyed by window; no Chrome API calls, so it's easy to reason about independent of the extension runtime.
  - `panelWindow.ts` — the docked panel window's lifecycle: attach/restore/follow/resize-sync against its tracked browser window, the macOS-fullscreen `chrome.sidePanel` fallback (gated on `chrome.sidePanel.open()`'s user-gesture requirement — see the comments around `handleActionClick`), and auto-reopen on startup.
  - `storage.ts` — wraps `chrome.storage.session` (ephemeral per-session state: which windows are tracked, current shrink amounts) and `chrome.storage.local` (durable prefs: side, width, whether the panel was left open).
- `src/panel/` — the panel window's UI: plain TypeScript + DOM rendering, no framework. Runs identically whether hosted in the floating popup or the `chrome.sidePanel` fallback.
- `src/shared/` — types and the message protocol between the two.

Built with Vite (no framework) — see `vite.config.ts` for the multi-entry build (service worker + panel page).
