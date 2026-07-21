import type { PanelSide, WindowTree } from "../shared/types";

const STORAGE_KEY = "windowTrees";
const PANEL_STORAGE_KEY = "panelState";
const PANEL_PREFS_KEY = "panelPrefs";

export async function loadState(): Promise<Record<number, WindowTree>> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Record<number, WindowTree> | undefined) ?? {};
}

export async function saveState(state: Record<number, WindowTree>): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}

// Ephemeral runtime bookkeeping — the window IDs it references are only
// valid for the current browser session, so this lives in session storage.
export interface PanelState {
  panelWindowId: number | null;
  trackedWindowId: number | null;
  shrunkWindowId: number | null;
  shrunkAmount: number;
  maximizeShrunk: boolean;
}

export async function loadPanelState(): Promise<PanelState> {
  const result = await chrome.storage.session.get(PANEL_STORAGE_KEY);
  return (
    (result[PANEL_STORAGE_KEY] as PanelState | undefined) ?? {
      panelWindowId: null,
      trackedWindowId: null,
      shrunkWindowId: null,
      shrunkAmount: 0,
      maximizeShrunk: false,
    }
  );
}

export async function savePanelState(state: PanelState): Promise<void> {
  await chrome.storage.session.set({ [PANEL_STORAGE_KEY]: state });
}

// User preferences — these should survive a full browser restart, so they
// live in local storage instead of session storage.
export interface PanelPrefs {
  side: PanelSide;
  panelWidth: number;
  panelWasOpen: boolean;
}

const DEFAULT_PREFS: PanelPrefs = { side: "right", panelWidth: 260, panelWasOpen: false };

export async function loadPanelPrefs(): Promise<PanelPrefs> {
  const result = await chrome.storage.local.get(PANEL_PREFS_KEY);
  return (result[PANEL_PREFS_KEY] as PanelPrefs | undefined) ?? DEFAULT_PREFS;
}

export async function savePanelPrefs(prefs: PanelPrefs): Promise<void> {
  await chrome.storage.local.set({ [PANEL_PREFS_KEY]: prefs });
}
