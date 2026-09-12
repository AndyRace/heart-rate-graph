import { useReducer, type ReactNode } from "react";
import { AppDispatchContext, AppStateContext } from "./app-context-values";
import { appReducer, initialAppState } from "./app-reducer";

export function AppProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
