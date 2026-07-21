import type { PanelSide, WindowTree } from "./types";

export interface GetTreeRequest {
  type: "GET_TREE";
  windowId: number;
}

export interface GetTreeResponse {
  tree: WindowTree;
  side: PanelSide;
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

export interface SetPanelSideRequest {
  type: "SET_PANEL_SIDE";
  side: PanelSide;
}

export type Request =
  | GetTreeRequest
  | ToggleCollapsedRequest
  | ActivateTabRequest
  | CloseTabRequest
  | SetPanelSideRequest;

export interface TreeUpdatedNotification {
  type: "TREE_UPDATED";
  windowId: number;
}

export interface SetTrackedWindowNotification {
  type: "SET_TRACKED_WINDOW";
  windowId: number;
}

export interface PanelSideChangedNotification {
  type: "PANEL_SIDE_CHANGED";
  side: PanelSide;
}

export type Notification =
  | TreeUpdatedNotification
  | SetTrackedWindowNotification
  | PanelSideChangedNotification;
