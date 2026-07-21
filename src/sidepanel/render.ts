import type { WindowTree } from "../shared/types";

export interface TreeHandlers {
  onActivate(tabId: number): void;
  onToggleCollapse(tabId: number): void;
  onClose(tabId: number): void;
}

const FALLBACK_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23999'/%3E%3C/svg%3E";

export function renderTree(container: HTMLElement, tree: WindowTree, handlers: TreeHandlers): void {
  container.innerHTML = "";
  const list = buildList(tree, tree.roots, handlers);
  container.appendChild(list);
}

function buildList(tree: WindowTree, ids: number[], handlers: TreeHandlers): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "tab-list";

  for (const id of ids) {
    const node = tree.nodes[id];
    if (!node) continue;

    const item = document.createElement("li");
    item.className = "tab-item";

    const row = document.createElement("div");
    row.className = "tab-row" + (node.active ? " active" : "");

    const toggle = document.createElement("span");
    toggle.className = "tab-toggle";
    if (node.children.length > 0) {
      toggle.textContent = node.collapsed ? "▶" : "▼";
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
    item.appendChild(row);

    if (node.children.length > 0 && !node.collapsed) {
      item.appendChild(buildList(tree, node.children, handlers));
    }

    list.appendChild(item);
  }

  return list;
}
