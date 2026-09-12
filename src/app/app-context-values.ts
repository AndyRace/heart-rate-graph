import { createContext, type Dispatch } from "react";
import type { AppAction, AppState } from "./app-reducer";

export const AppStateContext = createContext<AppState | undefined>(undefined);
export const AppDispatchContext = createContext<Dispatch<AppAction> | undefined>(undefined);
