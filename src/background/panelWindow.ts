import { loadPanelPrefs, loadPanelState, savePanelPrefs, savePanelState } from "./storage";
import type { PanelSide } from "../shared/types";

const MIN_MAIN_WIDTH = 200;
const DEBOUNCE_MS = 30;
const BOUNDS_TOLERANCE = 2;

let panelWindowId: number | null = null;
let trackedWindowId: number | null = null;
let shrunkWindowId: number | null = null;
// How much width we actually took from shrunkWindowId — NOT necessarily
// panelWidth, since we only take what's needed to avoid overflowing the
// screen (see planShrink). Restoring must add back exactly this, or a
// window that already had room (so wasn't shrunk at all) would grow the
// next time the panel reattaches to it across a browser restart.
let shrunkAmount = 0;
let panelWidth = 260;
let side: PanelSide = "right";
// Persisted so the panel can reopen itself automatically next time the
// browser starts, if it was left open when the browser last closed.
let panelWasOpen = false;
// Whether we've already compensated for the tracked window's *current*
// maximized episode. Persisted so a service-worker restart (MV3 workers are
// frequently evicted) can't forget and double-shrink the window.
let maximizeShrunk = false;
let repositionTimer: ReturnType<typeof setTimeout> | undefined;
let panelSyncTimer: ReturnType<typeof setTimeout> | undefined;

const readyPanel: Promise<void> = initPanelState();

async function verifyWindow(id: number | null): Promise<number | null> {
  if (id === null) return null;
  try {
    await chrome.windows.get(id);
    return id;
  } catch {
    return null;
  }
}

async function initPanelState(): Promise<void> {
  const [persisted, prefs] = await Promise.all([loadPanelState(), loadPanelPrefs()]);
  panelWindowId = await verifyWindow(persisted.panelWindowId);
  trackedWindowId = panelWindowId === null ? null : await verifyWindow(persisted.trackedWindowId);
  shrunkWindowId = panelWindowId === null ? null : await verifyWindow(persisted.shrunkWindowId);
  shrunkAmount = shrunkWindowId === null ? 0 : persisted.shrunkAmount;
  maximizeShrunk = shrunkWindowId === null ? false : persisted.maximizeShrunk;
  panelWidth = prefs.panelWidth;
  side = prefs.side;
  panelWasOpen = prefs.panelWasOpen;
}

async function persistState(): Promise<void> {
  await savePanelState({ panelWindowId, trackedWindowId, shrunkWindowId, shrunkAmount, maximizeShrunk });
}

async function persistPrefs(): Promise<void> {
  await savePanelPrefs({ side, panelWidth, panelWasOpen });
}

function isMaximized(win: chrome.windows.Window): boolean {
  return win.state === "maximized";
}

async function getDisplayForWindow(win: chrome.windows.Window): Promise<chrome.system.display.DisplayInfo> {
  const displays = await chrome.system.display.getInfo();
  const cx = (win.left ?? 0) + (win.width ?? 0) / 2;
  const cy = (win.top ?? 0) + (win.height ?? 0) / 2;
  const match = displays.find(
    (d) =>
      cx >= d.bounds.left &&
      cx < d.bounds.left + d.bounds.width &&
      cy >= d.bounds.top &&
      cy < d.bounds.top + d.bounds.height
  );
  return match ?? displays[0];
}

interface ShrinkPlan {
  needsShrink: boolean;
  newLeft: number;
  newWidth: number;
  shrinkAmount: number;
}

// Decides whether the window needs to give up any width at all: if it
// already leaves enough room on-screen for the panel next to it, we leave it
// untouched. This is what makes attaching idempotent — a window that was
// already shrunk to exactly fit (from a previous session, restored by the
// OS at its last-saved size) won't get shrunk *again* just because we don't
// remember doing it last time (chrome.storage.session is cleared on a full
// browser quit, but the OS still remembers the window's on-disk size).
function planShrink(win: chrome.windows.Window, area: { left: number; width: number }): ShrinkPlan {
  const screenLeft = area.left;
  const screenRight = area.left + area.width;
  const currentLeft = win.left ?? screenLeft;
  const currentWidth = win.width ?? Math.max(area.width - panelWidth, MIN_MAIN_WIDTH);

  let newLeft = currentLeft;
  let newWidth = currentWidth;

  if (side === "right") {
    const overflow = currentLeft + currentWidth + panelWidth - screenRight;
    if (overflow > 0) newWidth = Math.max(currentWidth - overflow, MIN_MAIN_WIDTH);
  } else {
    const overflow = screenLeft - (currentLeft - panelWidth);
    if (overflow > 0) {
      newLeft = currentLeft + overflow;
      newWidth = Math.max(currentWidth - overflow, MIN_MAIN_WIDTH);
    }
  }

  return {
    needsShrink: newWidth !== currentWidth || newLeft !== currentLeft,
    newLeft,
    newWidth,
    shrinkAmount: currentWidth - newWidth,
  };
}

// Shrinks the tracked window's width (and shifts it out of the way, for a
// left-docked panel) so the panel occupies freed-up screen space instead of
// covering the page underneath — but only as much as actually needed to fit
// the screen (see planShrink), so reattaching an already-shrunk window
// across a browser restart doesn't shrink it further each time.
async function attachPanelToWindow(windowId: number): Promise<chrome.windows.Window> {
  const win = await chrome.windows.get(windowId);
  const display = await getDisplayForWindow(win);
  const plan = planShrink(win, display.workArea);

  shrunkWindowId = plan.needsShrink ? windowId : null;
  shrunkAmount = plan.needsShrink ? plan.shrinkAmount : 0;
  maximizeShrunk = isMaximized(win);
  await persistState();

  if (!plan.needsShrink) return win;

  const update: chrome.windows.UpdateInfo =
    side === "right" ? { width: plan.newWidth } : { left: plan.newLeft, width: plan.newWidth };
  await chrome.windows.update(windowId, update).catch(() => {});
  return chrome.windows.get(windowId);
}

// Gives the tracked window back exactly the width it was shrunk by. Rather
// than snapping back to some remembered historical position, this just grows
// whatever the window's current bounds are — so it works whether the window
// is still where it started, was moved, or got maximized in the meantime.
async function restoreShrunkWindow(): Promise<void> {
  if (shrunkWindowId === null) return;
  const windowId = shrunkWindowId;
  const amount = shrunkAmount;
  shrunkWindowId = null;
  shrunkAmount = 0;
  maximizeShrunk = false;
  await persistState();
  if (amount <= 0) return;
  try {
    const win = await chrome.windows.get(windowId);
    const newWidth = (win.width ?? 0) + amount;
    const update: chrome.windows.UpdateInfo =
      side === "right" ? { width: newWidth } : { left: (win.left ?? 0) - amount, width: newWidth };
    await chrome.windows.update(windowId, update);
  } catch {
    // Window no longer exists — nothing to restore.
  }
}

// The edge of the main window that the panel sits flush against.
function mainTouchEdge(win: chrome.windows.Window): number {
  return side === "right" ? (win.left ?? 0) + (win.width ?? 0) : win.left ?? 0;
}

function panelBoundsFromMainWindow(win: chrome.windows.Window): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const edge = mainTouchEdge(win);
  return {
    left: side === "right" ? edge : edge - panelWidth,
    top: win.top ?? 0,
    width: panelWidth,
    height: win.height ?? 0,
  };
}

async function repositionPanel(): Promise<void> {
  if (panelWindowId === null || trackedWindowId === null) return;
  try {
    const mainWindow = await chrome.windows.get(trackedWindowId);
    const bounds = panelBoundsFromMainWindow(mainWindow);
    await chrome.windows.update(panelWindowId, bounds);
  } catch {
    panelWindowId = null;
    await persistState();
  }
}

function scheduleReposition(): void {
  if (repositionTimer !== undefined) clearTimeout(repositionTimer);
  repositionTimer = setTimeout(() => {
    repositionTimer = undefined;
    void repositionPanel();
  }, DEBOUNCE_MS);
}

// Maximizing the tracked window (e.g. double-clicking the title bar) grows
// it to fill the screen, covering the space the panel sits in — plain manual
// resizing should NOT trigger this, only an actual maximize transition,
// gated by `maximizeShrunk` so we act once per episode instead of
// re-shrinking on every subsequent bounds event.
async function reconcileMainWindowWidth(win: chrome.windows.Window): Promise<void> {
  if (win.id === undefined) return;

  if (win.state === "fullscreen") {
    // A truly fullscreen window can't have a docked companion window beside
    // it — macOS moves it to its own Space, and even elsewhere fullscreen
    // leaves no on-screen room. handleActionClick() switches this window
    // over to chrome.sidePanel instead (which lives inside the window
    // itself), gated on the click being a real user gesture. Nothing to do
    // here besides leaving the floating panel alone; the side panel is the
    // user's own native UI once open, so it's left for them to close.
    return;
  }

  if (!isMaximized(win)) {
    if (maximizeShrunk) {
      maximizeShrunk = false;
      await persistState();
    }
    return;
  }

  if (maximizeShrunk) return;
  const display = await getDisplayForWindow(win);
  const plan = planShrink(win, display.workArea);
  maximizeShrunk = true;
  shrunkWindowId = plan.needsShrink ? win.id : shrunkWindowId;
  shrunkAmount = plan.needsShrink ? plan.shrinkAmount : shrunkAmount;
  await persistState();
  if (!plan.needsShrink) return;
  const update: chrome.windows.UpdateInfo =
    side === "right" ? { width: plan.newWidth } : { left: plan.newLeft, width: plan.newWidth };
  await chrome.windows.update(win.id, update).catch(() => {});
}

// When the user manually resizes the panel window itself: grow/shrink the
// main window so their edges keep touching (no gap, no overlap), and snap
// the panel's height/vertical position back so it always mirrors the main
// window — the panel's height is locked, only its width is adjustable.
async function syncFromPanelBounds(): Promise<void> {
  if (panelWindowId === null || trackedWindowId === null) return;
  let panelWin: chrome.windows.Window;
  let mainWindow: chrome.windows.Window;
  try {
    panelWin = await chrome.windows.get(panelWindowId);
    mainWindow = await chrome.windows.get(trackedWindowId);
  } catch {
    return;
  }

  const observedWidth = panelWin.width ?? panelWidth;
  if (observedWidth !== panelWidth) {
    panelWidth = observedWidth;
    await persistPrefs();
  }

  const mainLeft = mainWindow.left ?? 0;
  const mainWidth = mainWindow.width ?? 0;
  const panelLeft = panelWin.left ?? 0;
  const panelWidthNow = panelWin.width ?? panelWidth;

  let desiredMainLeft = mainLeft;
  let desiredMainWidth: number;
  if (side === "right") {
    desiredMainWidth = Math.max(panelLeft - mainLeft, MIN_MAIN_WIDTH);
  } else {
    const anchorRight = mainLeft + mainWidth;
    desiredMainLeft = panelLeft + panelWidthNow;
    desiredMainWidth = Math.max(anchorRight - desiredMainLeft, MIN_MAIN_WIDTH);
    if (desiredMainWidth === MIN_MAIN_WIDTH) desiredMainLeft = anchorRight - MIN_MAIN_WIDTH;
  }

  const widthMismatch = Math.abs(mainWidth - desiredMainWidth) > BOUNDS_TOLERANCE;
  const leftMismatch = Math.abs(mainLeft - desiredMainLeft) > BOUNDS_TOLERANCE;
  if (widthMismatch || leftMismatch) {
    const update: chrome.windows.UpdateInfo =
      side === "right" ? { width: desiredMainWidth } : { left: desiredMainLeft, width: desiredMainWidth };
    await chrome.windows.update(trackedWindowId, update).catch(() => {});
  }

  const heightMismatch = Math.abs((panelWin.height ?? 0) - (mainWindow.height ?? 0)) > BOUNDS_TOLERANCE;
  const topMismatch = Math.abs((panelWin.top ?? 0) - (mainWindow.top ?? 0)) > BOUNDS_TOLERANCE;
  if (heightMismatch || topMismatch) {
    await chrome.windows
      .update(panelWindowId, { top: mainWindow.top, height: mainWindow.height })
      .catch(() => {});
  }
}

function schedulePanelSync(): void {
  if (panelSyncTimer !== undefined) clearTimeout(panelSyncTimer);
  panelSyncTimer = setTimeout(() => {
    panelSyncTimer = undefined;
    void syncFromPanelBounds();
  }, DEBOUNCE_MS);
}

function notifyTrackedWindow(windowId: number): void {
  chrome.runtime.sendMessage({ type: "SET_TRACKED_WINDOW", windowId }).catch(() => {
    // No panel listening right now — safe to ignore.
  });
}

function notifySideChanged(): void {
  chrome.runtime.sendMessage({ type: "PANEL_SIDE_CHANGED", side }).catch(() => {
    // No panel listening right now — safe to ignore.
  });
}

async function setTrackedWindow(windowId: number): Promise<void> {
  if (trackedWindowId === windowId) return;
  await restoreShrunkWindow();
  trackedWindowId = windowId;
  await persistState();
  await attachPanelToWindow(windowId);
  await repositionPanel();
  notifyTrackedWindow(windowId);
}

export function getCurrentSide(): PanelSide {
  return side;
}

export async function setPanelSide(newSide: PanelSide): Promise<void> {
  await readyPanel;
  if (side === newSide) return;
  await restoreShrunkWindow();
  side = newSide;
  await persistPrefs();
  if (trackedWindowId !== null) {
    await attachPanelToWindow(trackedWindowId);
    await repositionPanel();
  }
  notifySideChanged();
}

function buildPanelUrl(windowId: number): string {
  return chrome.runtime.getURL(`panel/index.html?windowId=${windowId}`);
}

function buildSidePanelPath(windowId: number): string {
  return `panel/index.html?windowId=${windowId}&mode=sidepanel`;
}

// Reloading the extension in chrome://extensions tears down and re-serves
// its resources, so any window still showing our old chrome-extension://
// page loses its content (Chrome falls it back to the New Tab page) even
// though the OS-level window itself keeps existing. Detect that and
// re-navigate it back to the panel instead of just focusing a blank window.
async function ensurePanelWindowContent(windowId: number, url: string): Promise<void> {
  const win = await chrome.windows.get(windowId, { populate: true });
  const tab = win.tabs?.[0];
  if (!tab || tab.id === undefined) return;
  if (!tab.url?.startsWith(chrome.runtime.getURL("panel/"))) {
    await chrome.tabs.update(tab.id, { url });
  }
}

export async function ensurePanelOpen(initialWindowId: number): Promise<void> {
  await readyPanel;

  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      await ensurePanelWindowContent(panelWindowId, buildPanelUrl(initialWindowId));
      await setTrackedWindow(initialWindowId);
      return;
    } catch {
      panelWindowId = null;
    }
  }

  trackedWindowId = initialWindowId;
  const mainWindow = await attachPanelToWindow(initialWindowId);
  const bounds = panelBoundsFromMainWindow(mainWindow);
  const url = buildPanelUrl(initialWindowId);

  const created = await chrome.windows.create({
    url,
    type: "popup",
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  });
  panelWindowId = created.id ?? null;
  await persistState();

  panelWasOpen = true;
  await persistPrefs();
}

// Reopens the panel automatically if it was still open last time and isn't
// currently open. Covers both a genuine full quit-and-relaunch (onStartup)
// and the more common case of closing the only window and opening a new one
// without quitting the browser process at all (onCreated) — Chrome keeps
// running in the background on most platforms unless the user quits it.
async function autoOpenPanelIfNeeded(candidateWindowId?: number): Promise<void> {
  await readyPanel;
  if (!panelWasOpen || panelWindowId !== null) return;

  if (candidateWindowId !== undefined) {
    await ensurePanelOpen(candidateWindowId);
    return;
  }

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const target = windows.find((w) => w.focused) ?? windows[0];
  if (target?.id === undefined) return;

  await ensurePanelOpen(target.id);
}

// chrome.sidePanel.open() is only allowed in direct response to a user
// gesture — a background listener reacting to a fullscreen transition
// doesn't qualify, but this handler (called straight from the toolbar
// click) does. So the fullscreen fallback can only ever be *entered* here,
// not proactively from a bounds-changed event.
//
// setOptions only accepts a tabId (not windowId) to scope a custom path, so
// this targets whichever tab is currently active in the window — if the
// user switches tabs afterward, the panel falls back to the manifest's
// plain default_path, and panel/main.ts resolves its windowId via
// chrome.windows.getCurrent() in that case instead of a URL param.
async function handleActionClick(windowId: number): Promise<void> {
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (win?.state === "fullscreen") {
    const [activeTab] = await chrome.tabs.query({ windowId, active: true });
    if (activeTab?.id !== undefined) {
      await chrome.sidePanel
        .setOptions({ tabId: activeTab.id, path: buildSidePanelPath(windowId), enabled: true })
        .catch(() => {});
    }
    await chrome.sidePanel.open({ windowId }).catch(() => {
      // Chrome refused the gesture check — nothing more we can do.
    });
    return;
  }

  await ensurePanelOpen(windowId);
}

export function registerPanelWindowListeners(): void {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    void handleActionClick(tab.windowId);
  });

  chrome.windows.onBoundsChanged.addListener((win) => {
    void readyPanel.then(async () => {
      if (win.id === undefined) return;
      if (win.id === trackedWindowId) {
        await reconcileMainWindowWidth(win);
        scheduleReposition();
      } else if (win.id === panelWindowId) {
        schedulePanelSync();
      }
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    void readyPanel.then(async () => {
      if (panelWindowId === null) return;
      if (windowId === chrome.windows.WINDOW_ID_NONE || windowId === panelWindowId) return;
      const win = await chrome.windows.get(windowId).catch(() => null);
      if (!win || win.type !== "normal") return;
      // A fullscreen window can't host the floating panel beside it (see
      // reconcileMainWindowWidth) — leave the panel tracking whatever normal
      // window it last had; the user can still reach this one's tree via
      // the toolbar-click sidePanel fallback.
      if (win.state === "fullscreen") return;
      await setTrackedWindow(windowId);
    });
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    void readyPanel.then(async () => {
      if (windowId === panelWindowId) {
        panelWindowId = null;
        await restoreShrunkWindow();
        trackedWindowId = null;
        await persistState();
        panelWasOpen = false;
        await persistPrefs();
        return;
      }
      if (windowId === trackedWindowId) {
        shrunkWindowId = null;
        shrunkAmount = 0;
        maximizeShrunk = false;
        await persistState();
        const remaining = await chrome.windows.getAll({ windowTypes: ["normal"] });
        const next = remaining.find((w) => w.id !== undefined && w.id !== panelWindowId);
        if (next?.id !== undefined) {
          await setTrackedWindow(next.id);
        } else if (panelWindowId !== null) {
          // Nothing left to dock to — close the panel window, but leave
          // panelWasOpen alone: this is losing its anchor, not the user
          // asking for the panel to be gone, so it should still come back
          // via onCreated/onStartup once a window exists again.
          await chrome.windows.remove(panelWindowId).catch(() => {});
          panelWindowId = null;
          trackedWindowId = null;
          await persistState();
        }
      }
    });
  });

  chrome.windows.onCreated.addListener((win) => {
    if (win.type !== "normal" || win.id === undefined) return;
    void autoOpenPanelIfNeeded(win.id);
  });

  chrome.runtime.onStartup.addListener(() => {
    void autoOpenPanelIfNeeded();
  });
}
