import type { TabNode, WindowTree } from "../shared/types";

export function createWindowTree(windowId: number): WindowTree {
  return { windowId, roots: [], nodes: {} };
}

function siblingList(tree: WindowTree, parentId: number | null): number[] {
  return parentId === null ? tree.roots : tree.nodes[parentId].children;
}

export function addTab(
  tree: WindowTree,
  tab: chrome.tabs.Tab,
  opts: { forceRoot?: boolean } = {}
): void {
  if (tab.id === undefined) return;
  const requestedParent = opts.forceRoot ? undefined : tab.openerTabId;
  const parentId =
    requestedParent !== undefined && tree.nodes[requestedParent] ? requestedParent : null;

  const node: TabNode = {
    id: tab.id,
    windowId: tree.windowId,
    parentId,
    children: [],
    collapsed: false,
    title: tab.title ?? "",
    favIconUrl: tab.favIconUrl ?? null,
    url: tab.url ?? "",
    active: !!tab.active,
  };

  tree.nodes[tab.id] = node;
  siblingList(tree, parentId).push(tab.id);
}

export function removeTab(tree: WindowTree, tabId: number): void {
  const node = tree.nodes[tabId];
  if (!node) return;

  const siblings = siblingList(tree, node.parentId);
  const index = siblings.indexOf(tabId);
  if (index !== -1) {
    siblings.splice(index, 1, ...node.children);
  }
  for (const childId of node.children) {
    const child = tree.nodes[childId];
    if (child) child.parentId = node.parentId;
  }

  delete tree.nodes[tabId];
}

export function updateTab(tree: WindowTree, tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return;
  const node = tree.nodes[tab.id];
  if (!node) return;
  node.title = tab.title ?? node.title;
  node.favIconUrl = tab.favIconUrl ?? node.favIconUrl;
  node.url = tab.url ?? node.url;
}

export function setActiveTab(tree: WindowTree, tabId: number): void {
  for (const node of Object.values(tree.nodes)) {
    node.active = node.id === tabId;
  }
}

export function toggleCollapsed(tree: WindowTree, tabId: number): boolean {
  const node = tree.nodes[tabId];
  if (!node) return false;
  node.collapsed = !node.collapsed;
  return true;
}
