import type { GetTreeResponse, Notification } from "../shared/messages";
import type { PanelSide, WindowTree } from "../shared/types";
import { renderTree } from "./render";

const container = document.getElementById("tree-root")!;
const sideToggle = document.getElementById("side-toggle") as HTMLButtonElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const newTabButton = document.getElementById("new-tab-button") as HTMLButtonElement;
let currentWindowId: number;
let currentSide: PanelSide = "right";
let lastTree: WindowTree | null = null;

// When hosted in chrome.sidePanel (the macOS-fullscreen fallback — see
// panelWindow.ts), this instance is permanently bound to its own window:
// there's no floating window to reposition, and the tracked-window/side
// broadcasts are meant for the floating panel, not this one. The floating
// popup always passes an explicit ?windowId=, so its absence means this
// loaded from the manifest's plain side_panel.default_path (e.g. the user
// switched tabs away from the one sidePanel.setOptions targeted).
const windowIdParam = new URLSearchParams(location.search).get("windowId");
const isSidePanelMode = new URLSearchParams(location.search).get("mode") === "sidepanel" || windowIdParam === null;
if (isSidePanelMode) {
  sideToggle.style.display = "none";
}

function applySideIndicator(): void {
  sideToggle.title = currentSide === "right" ? "Move panel to left side" : "Move panel to right side";
}

function render(): void {
  if (!lastTree) return;
  renderTree(
    container,
    lastTree,
    {
      onActivate: (tabId) => {
        void chrome.runtime.sendMessage({ type: "ACTIVATE_TAB", tabId });
      },
      onToggleCollapse: (tabId) => {
        void chrome.runtime.sendMessage({ type: "TOGGLE_COLLAPSED", tabId }).then(refresh);
      },
      onClose: (tabId) => {
        void chrome.runtime.sendMessage({ type: "CLOSE_TAB", tabId });
      },
    },
    searchInput.value
  );
}

async function refresh(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_TREE",
    windowId: currentWindowId,
  })) as GetTreeResponse;

  currentSide = response.side;
  applySideIndicator();
  lastTree = response.tree;
  render();
}

sideToggle.addEventListener("click", () => {
  const nextSide: PanelSide = currentSide === "right" ? "left" : "right";
  void chrome.runtime.sendMessage({ type: "SET_PANEL_SIDE", side: nextSide });
});

newTabButton.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "NEW_TAB", windowId: currentWindowId });
});

searchInput.addEventListener("input", render);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && searchInput.value) {
    event.stopPropagation();
    searchInput.value = "";
    render();
  }
});

async function init(): Promise<void> {
  if (windowIdParam !== null) {
    currentWindowId = Number(windowIdParam);
  } else {
    const win = await chrome.windows.getCurrent();
    currentWindowId = win.id!;
  }
  await refresh();
}

chrome.runtime.onMessage.addListener((message: Notification) => {
  if (message.type === "TREE_UPDATED" && message.windowId === currentWindowId) {
    void refresh();
  }
  if (message.type === "SET_TRACKED_WINDOW" && !isSidePanelMode) {
    currentWindowId = message.windowId;
    void refresh();
  }
  if (message.type === "PANEL_SIDE_CHANGED" && !isSidePanelMode) {
    currentSide = message.side;
    applySideIndicator();
  }
});

void init();
