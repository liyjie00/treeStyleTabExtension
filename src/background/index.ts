import {
  addTab,
  createWindowTree,
  dedupeTree,
  removeTab,
  setActiveTab,
  toggleCollapsed,
  updateTab,
} from "./tree";
import { loadState, saveState } from "./storage";
import { getCurrentSide, registerPanelWindowListeners, setPanelSide } from "./panelWindow";
import type { WindowTree } from "../shared/types";
import type { Request } from "../shared/messages";

let state: Record<number, WindowTree> = {};
let ready = initState();

async function initState(): Promise<void> {
  state = await loadState();
  for (const tree of Object.values(state)) {
    dedupeTree(tree);
  }

  const windows = await chrome.windows.getAll({ populate: true });
  for (const window of windows) {
    if (window.id === undefined) continue;
    if (state[window.id]) continue;

    const tree = createWindowTree(window.id);
    for (const tab of window.tabs ?? []) {
      addTab(tree, tab, { forceRoot: true });
    }
    state[window.id] = tree;
  }
  await saveState(state);
}

function getOrCreateTree(windowId: number): WindowTree {
  if (!state[windowId]) {
    state[windowId] = createWindowTree(windowId);
  }
  return state[windowId];
}

function findTreeForTab(tabId: number): WindowTree | undefined {
  return Object.values(state).find((tree) => tree.nodes[tabId] !== undefined);
}

function broadcastTreeUpdated(windowId: number): void {
  chrome.runtime.sendMessage({ type: "TREE_UPDATED", windowId }).catch(() => {
    // No panel window listening right now — safe to ignore.
  });
}

async function persistAndBroadcast(windowId: number): Promise<void> {
  await saveState(state);
  broadcastTreeUpdated(windowId);
}

registerPanelWindowListeners();

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.windowId === undefined) return;
  void ready.then(async () => {
    const tree = getOrCreateTree(tab.windowId);
    addTab(tree, tab);
    await persistAndBroadcast(tab.windowId);
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  void ready.then(async () => {
    const tree = state[removeInfo.windowId];
    if (!tree) return;
    removeTab(tree, tabId);
    await persistAndBroadcast(removeInfo.windowId);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!("title" in changeInfo) && !("favIconUrl" in changeInfo) && !("url" in changeInfo)) return;
  if (tab.windowId === undefined) return;
  void ready.then(async () => {
    const tree = state[tab.windowId];
    if (!tree) return;
    updateTab(tree, tab);
    await persistAndBroadcast(tab.windowId);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void ready.then(async () => {
    const tree = state[activeInfo.windowId];
    if (!tree) return;
    setActiveTab(tree, activeInfo.tabId);
    await persistAndBroadcast(activeInfo.windowId);
  });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  void ready.then(async () => {
    const tree = state[detachInfo.oldWindowId];
    if (!tree) return;
    removeTab(tree, tabId);
    await persistAndBroadcast(detachInfo.oldWindowId);
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  void ready.then(async () => {
    const tab = await chrome.tabs.get(tabId);
    const tree = getOrCreateTree(attachInfo.newWindowId);
    addTab(tree, tab, { forceRoot: true });
    await persistAndBroadcast(attachInfo.newWindowId);
  });
});

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  void ready.then(async () => {
    switch (message.type) {
      case "GET_TREE": {
        const tree = getOrCreateTree(message.windowId);
        sendResponse({ tree, side: getCurrentSide() });
        break;
      }
      case "TOGGLE_COLLAPSED": {
        const tree = findTreeForTab(message.tabId);
        if (tree) {
          toggleCollapsed(tree, message.tabId);
          await persistAndBroadcast(tree.windowId);
        }
        sendResponse({ ok: true });
        break;
      }
      case "ACTIVATE_TAB": {
        await chrome.tabs.update(message.tabId, { active: true });
        sendResponse({ ok: true });
        break;
      }
      case "CLOSE_TAB": {
        await chrome.tabs.remove(message.tabId);
        sendResponse({ ok: true });
        break;
      }
      case "SET_PANEL_SIDE": {
        await setPanelSide(message.side);
        sendResponse({ ok: true });
        break;
      }
      case "NEW_TAB": {
        await chrome.tabs.create({ windowId: message.windowId });
        sendResponse({ ok: true });
        break;
      }
    }
  });
  return true;
});
