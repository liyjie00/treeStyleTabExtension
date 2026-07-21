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

  // Chrome can deliver onCreated for a tab that's already tracked — e.g. on
  // browser startup, session-restored tabs fire onCreated while we're also
  // populating the tree from chrome.windows.getAll's already-open tabs.
  // Re-adding it must not push a second copy into the roots/children array.
  const existing = tree.nodes[tab.id];
  if (existing) {
    existing.title = tab.title ?? existing.title;
    existing.favIconUrl = tab.favIconUrl ?? existing.favIconUrl;
    existing.url = tab.url ?? existing.url;
    return;
  }

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

// Removes any accidental duplicate ids from roots/children arrays — a safety
// net for state that was persisted before the addTab dedup fix above existed.
export function dedupeTree(tree: WindowTree): void {
  tree.roots = Array.from(new Set(tree.roots));
  for (const node of Object.values(tree.nodes)) {
    node.children = Array.from(new Set(node.children));
  }
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
