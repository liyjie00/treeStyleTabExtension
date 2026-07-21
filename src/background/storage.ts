import type { WindowTree } from "../shared/types";

const STORAGE_KEY = "windowTrees";

export async function loadState(): Promise<Record<number, WindowTree>> {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Record<number, WindowTree> | undefined) ?? {};
}

export async function saveState(state: Record<number, WindowTree>): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}
