/**
 * React binding for the app store.
 *
 * The store is created during bootstrap (with the loaded installation) and
 * handed to the tree here, so no module-level singleton exists and the store
 * stays usable from plain Node tests.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import type { AppState, AppStore } from "./store";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({
  store,
  children,
}: {
  store: AppStore;
  children: ReactNode;
}) {
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

/**
 * Subscribes to exactly what `selector` returns. Pass a selector from
 * `./selectors` — see the identity rules documented there.
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("useAppStore used outside <StoreProvider>.");
  }
  return useStore(store, selector);
}
