import type { GetTreeResponse, Notification } from "../shared/messages";
import { renderTree } from "./render";

const container = document.getElementById("tree-root")!;
let currentWindowId: number;

async function refresh(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: "GET_TREE",
    windowId: currentWindowId,
  })) as GetTreeResponse;

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

async function init(): Promise<void> {
  const win = await chrome.windows.getCurrent();
  currentWindowId = win.id!;
  await refresh();
}

chrome.runtime.onMessage.addListener((message: Notification) => {
  if (message.type === "TREE_UPDATED" && message.windowId === currentWindowId) {
    void refresh();
  }
});

void init();
