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
  | "models"
  | "model-setup"
  | "conversation";

export type OverlayPanel =
  | "none"
  | "palette"
  | "config-overlay"
  | "team-dashboard"
  | "shortcuts-overlay"
  | "background-tasks";

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

function isModalOverlayPanel(panel: string): boolean {
  return panel === "palette" || panel === "config-overlay" ||
    panel === "team-dashboard" ||
    panel === "shortcuts-overlay" ||
    panel === "background-tasks";
}

function usesStandaloneSurfacePanel(surfacePanel: string): boolean {
  return surfacePanel === "models" || surfacePanel === "model-setup";
}

interface UseOverlayPanelInput {
  initReady: boolean;
  needsModelSetup: boolean;
}

export interface UseOverlayPanelResult {
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
  toggleTeamDashboard: () => void;
  toggleShortcutsOverlay: () => void;
  toggleBackgroundTasks: () => void;
}

export function useOverlayPanel(
  { initReady, needsModelSetup }: UseOverlayPanelInput,
): UseOverlayPanelResult {
  const [surfacePanel, setSurfacePanel] = useState<SurfacePanel>("none");
  const [activeOverlay, setActiveOverlay] = useState<OverlayPanel>("none");

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
      setSurfacePanel("model-setup");
    }
  }, [
    activeOverlay,
    initReady,
    needsModelSetup,
    modelSetupHandled,
    surfacePanel,
  ]);

  const toggleTeamDashboard = useMemo(
    () =>
      createOverlayToggle("team-dashboard", lastPanelToggleRef, setActiveOverlay),
    [],
  );
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
  const hasStandaloneSurface = usesStandaloneSurfacePanel(surfacePanel);

  return {
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
    toggleTeamDashboard,
    toggleShortcutsOverlay,
    toggleBackgroundTasks,
  };
}
