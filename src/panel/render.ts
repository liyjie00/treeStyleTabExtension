import type { MovePosition, TabNode, WindowTree } from "../shared/types";

export interface TreeHandlers {
  onActivate(tabId: number): void;
  onToggleCollapse(tabId: number): void;
  onClose(tabId: number): void;
  onMoveTab(tabId: number, targetTabId: number | null, position: MovePosition): void;
}

const FALLBACK_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23999'/%3E%3C/svg%3E";

const DROP_CLASSES = ["drop-before", "drop-after", "drop-inside"];

function clearDropIndicators(): void {
  document.querySelectorAll(".tab-row").forEach((el) => el.classList.remove(...DROP_CLASSES));
}

// Top quarter of the row = "insert before it", bottom quarter = "insert
// after it" (both as a sibling at the row's own level), middle half =
// "nest inside it as a child".
function zoneForEvent(row: HTMLElement, clientY: number): MovePosition {
  const rect = row.getBoundingClientRect();
  const ratio = (clientY - rect.top) / rect.height;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

function nodeMatches(node: TabNode, query: string): boolean {
  return node.title.toLowerCase().includes(query) || node.url.toLowerCase().includes(query);
}

// Search matches highlight rows and dim everything else, but ancestors of a
// match still need to be force-expanded (even if collapsed) so the match
// stays reachable — this walks up from every match collecting those ids.
function computeSearchState(
  tree: WindowTree,
  query: string
): { matches: Set<number>; forceExpand: Set<number> } {
  const matches = new Set<number>();
  const forceExpand = new Set<number>();
  if (!query) return { matches, forceExpand };

  for (const node of Object.values(tree.nodes)) {
    if (!nodeMatches(node, query)) continue;
    matches.add(node.id);
    let parentId = node.parentId;
    while (parentId !== null && !forceExpand.has(parentId)) {
      forceExpand.add(parentId);
      parentId = tree.nodes[parentId]?.parentId ?? null;
    }
  }
  return { matches, forceExpand };
}

export function renderTree(
  container: HTMLElement,
  tree: WindowTree,
  handlers: TreeHandlers,
  searchQuery = ""
): void {
  container.innerHTML = "";
  const query = searchQuery.trim().toLowerCase();
  const { matches, forceExpand } = computeSearchState(tree, query);
  const list = buildList(tree, tree.roots, handlers, query, matches, forceExpand);
  container.appendChild(list);
}

function buildList(
  tree: WindowTree,
  ids: number[],
  handlers: TreeHandlers,
  query: string,
  matches: Set<number>,
  forceExpand: Set<number>
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "tab-list";

  for (const id of ids) {
    const node = tree.nodes[id];
    if (!node) continue;

    const isMatch = matches.has(id);
    const searching = query.length > 0;
    const isOpen = !node.collapsed || forceExpand.has(id);

    const item = document.createElement("li");
    item.className = "tab-item";

    const row = document.createElement("div");
    row.className = "tab-row";
    if (node.active) row.classList.add("active");
    if (isMatch) row.classList.add("search-match");
    if (searching && !isMatch && !forceExpand.has(id)) row.classList.add("search-dim");

    const toggle = document.createElement("span");
    toggle.className = "tab-toggle";
    if (node.children.length > 0) {
      toggle.textContent = isOpen ? "▼" : "▶";
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onToggleCollapse(node.id);
      });
    } else {
      toggle.classList.add("tab-toggle-empty");
    }
    row.appendChild(toggle);

    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.src = node.favIconUrl || FALLBACK_FAVICON;
    favicon.addEventListener("error", () => {
      favicon.src = FALLBACK_FAVICON;
    });
    row.appendChild(favicon);

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = node.title || node.url || "(untitled)";
    row.appendChild(title);

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onClose(node.id);
    });
    row.appendChild(close);

    row.addEventListener("click", () => handlers.onActivate(node.id));

    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer?.setData("text/plain", String(node.id));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearDropIndicators();
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearDropIndicators();
      row.classList.add(`drop-${zoneForEvent(row, event.clientY)}`);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove(...DROP_CLASSES);
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearDropIndicators();
      const draggedIdRaw = event.dataTransfer?.getData("text/plain");
      if (!draggedIdRaw) return;
      const draggedId = Number(draggedIdRaw);
      if (draggedId === node.id) return;
      handlers.onMoveTab(draggedId, node.id, zoneForEvent(row, event.clientY));
    });

    item.appendChild(row);

    if (node.children.length > 0 && isOpen) {
      item.appendChild(buildList(tree, node.children, handlers, query, matches, forceExpand));
    }

    list.appendChild(item);
  }

  return list;
}
