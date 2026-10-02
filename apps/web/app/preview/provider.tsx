"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
} from "react";

type DemoState = {
  followed: string[];
  setFollowed: Dispatch<SetStateAction<string[]>>;
  timezone: string;
  setTimezone: Dispatch<SetStateAction<string>>;
  analytics: boolean;
  setAnalytics: Dispatch<SetStateAction<boolean>>;
};
const Context = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState(["moabit", "pureun", "onyu"]);
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [analytics, setAnalytics] = useState(false);
  return (
    <Context.Provider
      value={{
        followed,
        setFollowed,
        timezone,
        setTimezone,
        analytics,
        setAnalytics,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDemo() {
  const state = useContext(Context);
  if (!state) throw new Error("Preview requires DemoProvider");
  return state;
}
