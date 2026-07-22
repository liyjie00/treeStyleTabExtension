import type { MovePosition, TabNode, WindowTree } from "../shared/types";

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

// Returns true if `nodeId` is `ancestorId` itself, or anywhere in its
// subtree — used to reject drag-and-drop moves that would create a cycle.
function isSelfOrDescendant(tree: WindowTree, ancestorId: number, nodeId: number): boolean {
  let current: number | null = nodeId;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = tree.nodes[current]?.parentId ?? null;
  }
  return false;
}

// Drag-and-drop reparent/reorder. `targetTabId: null` means "make this a
// root tab, appended at the end" — position is irrelevant in that case.
// The dragged node's own subtree moves with it untouched; only its own
// parentId (and its old/new siblings arrays) change.
export function moveTab(
  tree: WindowTree,
  tabId: number,
  targetTabId: number | null,
  position: MovePosition
): void {
  if (tabId === targetTabId) return;
  const node = tree.nodes[tabId];
  if (!node) return;

  let newParentId: number | null;
  if (targetTabId === null) {
    newParentId = null;
  } else {
    const targetNode = tree.nodes[targetTabId];
    if (!targetNode) return;
    newParentId = position === "inside" ? targetTabId : targetNode.parentId;
  }

  // Reject moves that would drop a node into its own subtree.
  if (newParentId !== null && isSelfOrDescendant(tree, tabId, newParentId)) return;

  const oldSiblings = siblingList(tree, node.parentId);
  const oldIndex = oldSiblings.indexOf(tabId);
  if (oldIndex !== -1) oldSiblings.splice(oldIndex, 1);

  node.parentId = newParentId;

  if (targetTabId === null) {
    tree.roots.push(tabId);
    return;
  }

  if (position === "inside") {
    tree.nodes[targetTabId].children.push(tabId);
    return;
  }

  const newSiblings = siblingList(tree, newParentId);
  const targetIndex = newSiblings.indexOf(targetTabId);
  const insertAt = targetIndex === -1 ? newSiblings.length : position === "before" ? targetIndex : targetIndex + 1;
  newSiblings.splice(insertAt, 0, tabId);
}
