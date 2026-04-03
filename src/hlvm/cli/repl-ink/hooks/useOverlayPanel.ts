/**
 * useOverlayPanel — Manages overlay/surface panel state machine and toggles.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PaletteState } from "../components/CommandPaletteOverlay.tsx";
import type { ConfigOverlayState } from "../components/ConfigOverlay.tsx";
import { resetTerminalViewport } from "../../ansi.ts";

export type SurfacePanel =
  | "none"
  | "conversation";

export type OverlayPanel =
  | "none"
  | "palette"
  | "models"
  | "model-setup"
  | "config-overlay"
  | "execution-surface"
  | "shortcuts-overlay"
  | "transcript-history"
  | "background-tasks";

export type ShellRoute =
  | { kind: "shell"; overlay: OverlayPanel }
  | { kind: "conversation"; overlay: OverlayPanel };

function createOverlayToggle(
  panelName: OverlayPanel,
  lastToggleRef: MutableRefObject<number>,
  setOverlay: Dispatch<SetStateAction<OverlayPanel>>,
): () => void {
  return () => {
    const now = Date.now();
    if (now - lastToggleRef.current < 150) return;
    lastToggleRef.current = now;
    setOverlay((prev: OverlayPanel) =>
      prev === panelName ? "none" : panelName
    );
  };
}

function isModalOverlayPanel(panel: OverlayPanel): boolean {
  return panel !== "none";
}

interface UseOverlayPanelInput {
  initReady: boolean;
  needsModelSetup: boolean;
}

export interface UseOverlayPanelResult {
  route: ShellRoute;
  setRoute: Dispatch<SetStateAction<ShellRoute>>;
  surfacePanel: SurfacePanel;
  setSurfacePanel: Dispatch<SetStateAction<SurfacePanel>>;
  activeOverlay: OverlayPanel;
  setActiveOverlay: Dispatch<SetStateAction<OverlayPanel>>;
  isOverlayOpen: boolean;
  hasStandaloneSurface: boolean;
  modelBrowserParentOverlay: OverlayPanel;
  setModelBrowserParentOverlay: Dispatch<
    SetStateAction<OverlayPanel>
  >;
  modelBrowserParentSurface: SurfacePanel;
  setModelBrowserParentSurface: Dispatch<
    SetStateAction<SurfacePanel>
  >;
  modelSetupHandled: boolean;
  setModelSetupHandled: Dispatch<SetStateAction<boolean>>;
  paletteState: PaletteState;
  setPaletteState: Dispatch<SetStateAction<PaletteState>>;
  configOverlayState: ConfigOverlayState;
  setConfigOverlayState: Dispatch<
    SetStateAction<ConfigOverlayState>
  >;
  togglePalette: () => void;
  toggleShortcutsOverlay: () => void;
  toggleTranscriptHistory: () => void;
  toggleBackgroundTasks: () => void;
}

export function useOverlayPanel(
  { initReady, needsModelSetup }: UseOverlayPanelInput,
): UseOverlayPanelResult {
  const [route, setRoute] = useState<ShellRoute>({
    kind: "shell",
    overlay: "none",
  });
  const surfacePanel = route.kind === "conversation" ? "conversation" : "none";
  const activeOverlay = route.overlay;

  const setSurfacePanel = useMemo<Dispatch<SetStateAction<SurfacePanel>>>(
    () => (value: SetStateAction<SurfacePanel>) => {
      setRoute((prev: ShellRoute) => {
        const prevValue = prev.kind === "conversation"
          ? "conversation"
          : "none";
        const nextValue = typeof value === "function" ? value(prevValue) : value;
        const overlay = prev.overlay;
        switch (nextValue) {
          case "conversation":
            return { kind: "conversation", overlay };
          default:
            return { kind: "shell", overlay };
        }
      });
    },
    [],
  );

  const setActiveOverlay = useMemo<Dispatch<SetStateAction<OverlayPanel>>>(
    () => (value: SetStateAction<OverlayPanel>) => {
      setRoute((prev: ShellRoute) => {
        const prevValue = prev.overlay;
        const nextValue = typeof value === "function" ? value(prevValue) : value;
        return prev.kind === "conversation"
          ? { kind: "conversation", overlay: nextValue }
          : { kind: "shell", overlay: nextValue };
      });
    },
    [],
  );

  // Track where ModelBrowser was opened from (for back navigation)
  const [modelBrowserParentOverlay, setModelBrowserParentOverlay] = useState<
    OverlayPanel
  >("none");
  const [modelBrowserParentSurface, setModelBrowserParentSurface] = useState<
    SurfacePanel
  >("none");

  // Track if model setup has been handled (completed or cancelled) to prevent infinite loop
  const [modelSetupHandled, setModelSetupHandled] = useState(false);

  // Debounce ref for panel toggles
  const lastPanelToggleRef = useRef<number>(0);

  // Command palette persistent state (survives open/close)
  const [paletteState, setPaletteState] = useState<PaletteState>({
    query: "",
    cursorPos: 0,
    selectedIndex: 0,
    scrollOffset: 0,
  });

  // Config overlay persistent state (survives open/close)
  const [configOverlayState, setConfigOverlayState] = useState<
    ConfigOverlayState
  >({
    selectedIndex: 0,
  });

  // Reset terminal viewport when overlay changes
  const previousOverlayRef = useRef<OverlayPanel>("none");
  useEffect(() => {
    if (previousOverlayRef.current === activeOverlay) return;
    resetTerminalViewport();
    previousOverlayRef.current = activeOverlay;
  }, [activeOverlay]);

  // Show model setup overlay if default model needs to be downloaded (only once)
  useEffect(() => {
    if (
      initReady && needsModelSetup && surfacePanel === "none" &&
      activeOverlay === "none" &&
      !modelSetupHandled
    ) {
      setActiveOverlay("model-setup");
    }
  }, [
    activeOverlay,
    initReady,
    needsModelSetup,
    modelSetupHandled,
    setActiveOverlay,
    surfacePanel,
  ]);

  const togglePalette = useMemo(
    () =>
      createOverlayToggle("palette", lastPanelToggleRef, setActiveOverlay),
    [],
  );
  const toggleShortcutsOverlay = useMemo(
    () =>
      createOverlayToggle(
        "shortcuts-overlay",
        lastPanelToggleRef,
        setActiveOverlay,
      ),
    [],
  );
  const toggleTranscriptHistory = useMemo(
    () =>
      createOverlayToggle(
        "transcript-history",
        lastPanelToggleRef,
        setActiveOverlay,
      ),
    [],
  );
  const toggleBackgroundTasks = useMemo(
    () =>
      createOverlayToggle(
        "background-tasks",
        lastPanelToggleRef,
        setActiveOverlay,
      ),
    [],
  );

  const isOverlayOpen = isModalOverlayPanel(activeOverlay);
  const hasStandaloneSurface = false;

  return {
    route,
    setRoute,
    surfacePanel,
    setSurfacePanel,
    activeOverlay,
    setActiveOverlay,
    isOverlayOpen,
    hasStandaloneSurface,
    modelBrowserParentOverlay,
    setModelBrowserParentOverlay,
    modelBrowserParentSurface,
    setModelBrowserParentSurface,
    modelSetupHandled,
    setModelSetupHandled,
    paletteState,
    setPaletteState,
    configOverlayState,
    setConfigOverlayState,
    togglePalette,
    toggleShortcutsOverlay,
    toggleTranscriptHistory,
    toggleBackgroundTasks,
  };
}
