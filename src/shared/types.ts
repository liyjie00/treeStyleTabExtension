export interface TabNode {
  id: number;
  windowId: number;
  parentId: number | null;
  children: number[];
  collapsed: boolean;
  title: string;
  url: string;
  active: boolean;
}

export type Tree = Record<number, TabNode>;

export interface WindowTree {
  windowId: number;
  roots: number[];
  nodes: Tree;
}

export type PanelSide = "left" | "right";

export type MovePosition = "before" | "after" | "inside";
