import { loadPanelPrefs, loadPanelState, savePanelPrefs, savePanelState } from "./storage";
import type { PanelSide } from "../shared/types";

const MIN_MAIN_WIDTH = 200;
const DEBOUNCE_MS = 30;
const BOUNDS_TOLERANCE = 2;

let panelWindowId: number | null = null;
let trackedWindowId: number | null = null;
let shrunkWindowId: number | null = null;
let panelWidth = 260;
let side: PanelSide = "right";
// Whether we've already compensated for the tracked window's *current*
// maximized/fullscreen episode. Persisted so a service-worker restart (MV3
// workers are frequently evicted) can't forget and double-shrink the window.
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
  maximizeShrunk = shrunkWindowId === null ? false : persisted.maximizeShrunk;
  panelWidth = prefs.panelWidth;
  side = prefs.side;
}

async function persistState(): Promise<void> {
  await savePanelState({ panelWindowId, trackedWindowId, shrunkWindowId, maximizeShrunk });
}

async function persistPrefs(): Promise<void> {
  await savePanelPrefs({ side, panelWidth });
}

function isMaximizedLike(win: chrome.windows.Window): boolean {
  return win.state === "maximized" || win.state === "fullscreen";
}

// The edge of the main window that the panel sits flush against.
function mainTouchEdge(win: chrome.windows.Window): number {
  return side === "right" ? (win.left ?? 0) + (win.width ?? 0) : win.left ?? 0;
}

// Shrinks the tracked window's width (and shifts it out of the way, for a
// left-docked panel) so the panel occupies freed-up screen space instead of
// covering the page underneath.
async function attachPanelToWindow(windowId: number): Promise<chrome.windows.Window> {
  const win = await chrome.windows.get(windowId);
  const currentLeft = win.left ?? 0;
  const currentWidth = win.width ?? panelWidth + MIN_MAIN_WIDTH;
  const newWidth = Math.max(currentWidth - panelWidth, MIN_MAIN_WIDTH);
  const actualShrink = currentWidth - newWidth;

  shrunkWindowId = windowId;
  maximizeShrunk = isMaximizedLike(win);
  await persistState();

  const update: chrome.windows.UpdateInfo =
    side === "right" ? { width: newWidth } : { left: currentLeft + actualShrink, width: newWidth };
  await chrome.windows.update(windowId, update).catch(() => {});
  return chrome.windows.get(windowId);
}

// Gives the tracked window back the width the panel was borrowing. Rather
// than snapping back to some remembered historical position, this just grows
// whatever the window's current bounds are — so it works whether the window
// is still where it started, was moved, or got maximized in the meantime.
async function restoreShrunkWindow(): Promise<void> {
  if (shrunkWindowId === null) return;
  const windowId = shrunkWindowId;
  shrunkWindowId = null;
  maximizeShrunk = false;
  await persistState();
  try {
    const win = await chrome.windows.get(windowId);
    const newWidth = (win.width ?? 0) + panelWidth;
    const update: chrome.windows.UpdateInfo =
      side === "right" ? { width: newWidth } : { left: (win.left ?? 0) - panelWidth, width: newWidth };
    await chrome.windows.update(windowId, update);
  } catch {
    // Window no longer exists — nothing to restore.
  }
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

// Maximizing / fullscreening the tracked window (e.g. double-clicking the
// title bar) grows it to fill the screen, covering the space the panel sits
// in — plain manual resizing should NOT trigger this, only an actual
// maximize/fullscreen transition, gated by `maximizeShrunk` so we act once
// per episode instead of re-shrinking on every subsequent bounds event.
async function reconcileMainWindowWidth(win: chrome.windows.Window): Promise<void> {
  if (win.id === undefined) return;

  if (!isMaximizedLike(win)) {
    if (maximizeShrunk) {
      maximizeShrunk = false;
      await persistState();
    }
    return;
  }

  if (maximizeShrunk) return;
  const currentLeft = win.left ?? 0;
  const currentWidth = win.width ?? 0;
  const newWidth = Math.max(currentWidth - panelWidth, MIN_MAIN_WIDTH);
  const actualShrink = currentWidth - newWidth;
  maximizeShrunk = true;
  await persistState();
  const update: chrome.windows.UpdateInfo =
    side === "right" ? { width: newWidth } : { left: currentLeft + actualShrink, width: newWidth };
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

export async function ensurePanelOpen(initialWindowId: number): Promise<void> {
  await readyPanel;

  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      await setTrackedWindow(initialWindowId);
      return;
    } catch {
      panelWindowId = null;
    }
  }

  trackedWindowId = initialWindowId;
  const mainWindow = await attachPanelToWindow(initialWindowId);
  const bounds = panelBoundsFromMainWindow(mainWindow);
  const url = chrome.runtime.getURL(`panel/index.html?windowId=${initialWindowId}`);

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
}

export function registerPanelWindowListeners(): void {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    void ensurePanelOpen(tab.windowId);
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
        return;
      }
      if (windowId === trackedWindowId) {
        shrunkWindowId = null;
        maximizeShrunk = false;
        await persistState();
        const remaining = await chrome.windows.getAll({ windowTypes: ["normal"] });
        const next = remaining.find((w) => w.id !== undefined && w.id !== panelWindowId);
        if (next?.id !== undefined) {
          await setTrackedWindow(next.id);
        } else if (panelWindowId !== null) {
          await chrome.windows.remove(panelWindowId).catch(() => {});
          panelWindowId = null;
          trackedWindowId = null;
          await persistState();
        }
      }
    });
  });
}
