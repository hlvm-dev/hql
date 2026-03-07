import { THEMES, type ThemeName } from "./palettes.ts";

let currentThemeName: ThemeName = "sicp";

export function normalizeThemeName(name: unknown): ThemeName {
  return typeof name === "string" && name in THEMES
    ? name as ThemeName
    : "sicp";
}

export function getCurrentThemeName(): ThemeName {
  return currentThemeName;
}

export function setCurrentThemeName(name: unknown): ThemeName {
  currentThemeName = normalizeThemeName(name);
  return currentThemeName;
}
