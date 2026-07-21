import type { GetTreeResponse, Notification } from "../shared/messages";
import type { PanelSide } from "../shared/types";
import { renderTree } from "./render";

const container = document.getElementById("tree-root")!;
const sideToggle = document.getElementById("side-toggle") as HTMLButtonElement;
let currentWindowId: number;
let currentSide: PanelSide = "right";

function applySideIndicator(): void {
  sideToggle.title = currentSide === "right" ? "Move panel to left side" : "Move panel to right side";
}

async function refresh(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_TREE",
    windowId: currentWindowId,
  })) as GetTreeResponse;

  currentSide = response.side;
  applySideIndicator();

  renderTree(container, response.tree, {
    onActivate: (tabId) => {
      void chrome.runtime.sendMessage({ type: "ACTIVATE_TAB", tabId });
    },
    onToggleCollapse: (tabId) => {
      void chrome.runtime.sendMessage({ type: "TOGGLE_COLLAPSED", tabId }).then(refresh);
    },
    onClose: (tabId) => {
      void chrome.runtime.sendMessage({ type: "CLOSE_TAB", tabId });
    },
  });
}

sideToggle.addEventListener("click", () => {
  const nextSide: PanelSide = currentSide === "right" ? "left" : "right";
  void chrome.runtime.sendMessage({ type: "SET_PANEL_SIDE", side: nextSide });
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
