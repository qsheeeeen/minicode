import React, { createContext, useContext, useReducer, ReactNode } from "react";
import type { DisplayMessage, Prompt } from "../utils/display.js";
import type { AgentSession, PermissionMode } from "../services/index.js";

export interface InputState {
  mode: string;
  value: string;
  props: Record<string, unknown>;
  key: number;
}

export interface SessionListState {
  sessions: Array<{ name: string }>;
  selectedIndex: number;
}

export interface TuiState {
  messages: DisplayMessage[];
  input: InputState;
  sessionList: SessionListState;
  agentSessions: AgentSession[];
  activeAgentId: string;
  tokenCount: number;
  currentSession: string;
  isLoading: boolean;
  status: string;
  permissionMode: PermissionMode;
  pendingPrompt: (Prompt & { resolve: (value: string) => void }) | null;
}

export type TuiAction =
  | { type: "SET_MESSAGES"; payload: DisplayMessage[] }
  | { type: "ADD_MESSAGE"; payload: DisplayMessage }
  | {
      type: "SET_INPUT_MODE";
      payload: { mode: string; props?: Record<string, unknown> };
    }
  | { type: "SET_INPUT_VALUE"; payload: string }
  | { type: "INCREMENT_INPUT_KEY" }
  | {
      type: "SET_SESSION_LIST";
      payload: { sessions: Array<{ name: string }>; selectedIndex?: number };
    }
  | { type: "SET_SELECTED_SESSION_INDEX"; payload: number }
  | { type: "SET_AGENT_SESSIONS"; payload: AgentSession[] }
  | { type: "SET_ACTIVE_AGENT_ID"; payload: string }
  | { type: "SET_TOKEN_COUNT"; payload: number }
  | { type: "SET_CURRENT_SESSION"; payload: string }
  | { type: "SET_IS_LOADING"; payload: boolean }
  | { type: "SET_STATUS"; payload: string }
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | {
      type: "SET_PENDING_PROMPT";
      payload: (Prompt & { resolve: (value: string) => void }) | null;
    };

export const initialState: TuiState = {
  messages: [],
  input: {
    mode: "chat",
    value: "",
    props: {},
    key: 0,
  },
  sessionList: {
    sessions: [],
    selectedIndex: 0,
  },
  agentSessions: [],
  activeAgentId: "1",
  tokenCount: 0,
  currentSession: "",
  isLoading: false,
  status: "",
  permissionMode: "manual",
  pendingPrompt: null,
};

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "SET_INPUT_MODE":
      return {
        ...state,
        input: {
          ...state.input,
          mode: action.payload.mode,
          props: action.payload.props || {},
        },
      };
    case "SET_INPUT_VALUE":
      if (state.input.value === action.payload) return state;
      return {
        ...state,
        input: {
          ...state.input,
          value: action.payload,
        },
      };
    case "INCREMENT_INPUT_KEY":
      return {
        ...state,
        input: {
          ...state.input,
          key: state.input.key + 1,
        },
      };
    case "SET_SESSION_LIST":
      return {
        ...state,
        sessionList: {
          sessions: action.payload.sessions,
          selectedIndex:
            action.payload.selectedIndex ?? state.sessionList.selectedIndex,
        },
      };
    case "SET_SELECTED_SESSION_INDEX":
      if (state.sessionList.selectedIndex === action.payload) return state;
      return {
        ...state,
        sessionList: {
          ...state.sessionList,
          selectedIndex: action.payload,
        },
      };
    case "SET_AGENT_SESSIONS":
      return { ...state, agentSessions: action.payload };
    case "SET_ACTIVE_AGENT_ID":
      if (state.activeAgentId === action.payload) return state;
      return { ...state, activeAgentId: action.payload };
    case "SET_TOKEN_COUNT":
      if (state.tokenCount === action.payload) return state;
      return { ...state, tokenCount: action.payload };
    case "SET_CURRENT_SESSION":
      if (state.currentSession === action.payload) return state;
      return { ...state, currentSession: action.payload };
    case "SET_IS_LOADING":
      if (state.isLoading === action.payload) return state;
      return { ...state, isLoading: action.payload };
    case "SET_STATUS":
      if (state.status === action.payload) return state;
      return { ...state, status: action.payload };
    case "SET_PERMISSION_MODE":
      if (state.permissionMode === action.payload) return state;
      return { ...state, permissionMode: action.payload };
    case "SET_PENDING_PROMPT":
      return { ...state, pendingPrompt: action.payload };
    default:
      return state;
  }
}

const TuiStateContext = createContext<TuiState | undefined>(undefined);
const TuiDispatchContext = createContext<React.Dispatch<TuiAction> | undefined>(
  undefined,
);

export function TuiProvider({
  children,
  initialState: init = initialState,
}: {
  children: ReactNode;
  initialState?: Partial<TuiState>;
}) {
  const [state, dispatch] = useReducer(tuiReducer, {
    ...initialState,
    ...init,
  });

  return (
    <TuiStateContext.Provider value={state}>
      <TuiDispatchContext.Provider value={dispatch}>
        {children}
      </TuiDispatchContext.Provider>
    </TuiStateContext.Provider>
  );
}

export function useTuiState() {
  const context = useContext(TuiStateContext);
  if (context === undefined) {
    throw new Error("useTuiState must be used within a TuiProvider");
  }
  return context;
}

export function useTuiDispatch() {
  const context = useContext(TuiDispatchContext);
  if (context === undefined) {
    throw new Error("useTuiDispatch must be used within a TuiProvider");
  }
  return context;
}
