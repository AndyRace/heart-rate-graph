import { useContext, type Dispatch } from "react";
import { AppDispatchContext, AppStateContext } from "./app-context-values";
import type { AppAction, AppState } from "./app-reducer";

export function useAppState(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used within AppProvider");
  return value;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const value = useContext(AppDispatchContext);
  if (!value) throw new Error("useAppDispatch must be used within AppProvider");
  return value;
}
