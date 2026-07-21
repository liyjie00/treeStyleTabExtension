import type { WindowTree } from "./types";

export interface GetTreeRequest {
  type: "GET_TREE";
  windowId: number;
}

export interface GetTreeResponse {
  tree: WindowTree;
}

export interface ToggleCollapsedRequest {
  type: "TOGGLE_COLLAPSED";
  tabId: number;
}

export interface ActivateTabRequest {
  type: "ACTIVATE_TAB";
  tabId: number;
}

export interface CloseTabRequest {
  type: "CLOSE_TAB";
  tabId: number;
}

export type Request = GetTreeRequest | ToggleCollapsedRequest | ActivateTabRequest | CloseTabRequest;

export interface TreeUpdatedNotification {
  type: "TREE_UPDATED";
  windowId: number;
}

export type Notification = TreeUpdatedNotification;
