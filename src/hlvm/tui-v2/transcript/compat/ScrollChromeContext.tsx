import React from "react";

export type StickyPrompt = {
  text: string;
  scrollTo: () => void;
} | "clicked";

export const ScrollChromeContext = React.createContext<{
  setStickyPrompt: React.Dispatch<React.SetStateAction<StickyPrompt | null>>;
}>({
  setStickyPrompt: () => {},
});
