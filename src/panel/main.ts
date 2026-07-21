import type { GetTreeResponse, Notification } from "../shared/messages";
import type { PanelSide, WindowTree } from "../shared/types";
import { renderTree } from "./render";

const container = document.getElementById("tree-root")!;
const sideToggle = document.getElementById("side-toggle") as HTMLButtonElement;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
let currentWindowId: number;
let currentSide: PanelSide = "right";
let lastTree: WindowTree | null = null;

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

searchInput.addEventListener("input", render);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && searchInput.value) {
    event.stopPropagation();
    searchInput.value = "";
    render();
  }
});

async function init(): Promise<void> {
  const windowIdParam = new URLSearchParams(location.search).get("windowId");
  currentWindowId = Number(windowIdParam);
  await refresh();
}

chrome.runtime.onMessage.addListener((message: Notification) => {
  if (message.type === "TREE_UPDATED" && message.windowId === currentWindowId) {
    void refresh();
  }
  if (message.type === "SET_TRACKED_WINDOW") {
    currentWindowId = message.windowId;
    void refresh();
  }
  if (message.type === "PANEL_SIDE_CHANGED") {
    currentSide = message.side;
    applySideIndicator();
  }
});

void init();
