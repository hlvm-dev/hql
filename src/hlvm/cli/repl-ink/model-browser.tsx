/**
 * Standalone Model Browser (Ink)
 *
 * Provides an interactive CLI UI for downloading and selecting models.
 */

import React, { useCallback, useRef } from "react";
import { render, useApp } from "ink";
import { ThemeProvider } from "../theme/index.ts";
import { ModelBrowser } from "./components/ModelBrowser.tsx";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { persistSelectedModelConfig } from "../../../common/config/model-selection.ts";
import {
  getRuntimeConfigApi,
} from "../../runtime/host-client.ts";
import { createRuntimeConfigManager } from "../../runtime/model-config.ts";
import { setCurrentThemeName } from "../theme/state.ts";

export interface ModelBrowserOptions {
  endpoint?: string;
  currentModel?: string;
  currentModelConfigured?: boolean;
}

export interface ModelBrowserResult {
  code: number;
  selectedModel?: string;
}

interface ModelBrowserAppProps {
  endpoint?: string;
  currentModel?: string;
  currentModelConfigured?: boolean;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

function ModelBrowserApp(
  { endpoint, currentModel, currentModelConfigured, onSelect, onCancel }: ModelBrowserAppProps,
): React.ReactElement {
  const { exit } = useApp();
  const doneRef = useRef(false);
  const selectedModelRef = useRef<string | undefined>(undefined);

  const finish = useCallback((model?: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (model) {
      onSelect(model);
    } else {
      onCancel();
    }
    exit();
  }, [exit, onCancel, onSelect]);

  const handleSelect = useCallback(async (modelName: string) => {
    const normalized = await persistSelectedModelConfig(
      getRuntimeConfigApi(),
      modelName,
    );
    selectedModelRef.current = normalized;
  }, []);

  const handleClose = useCallback(() => {
    finish(selectedModelRef.current);
  }, [finish]);

  return (
    <ModelBrowser
      endpoint={endpoint}
      currentModel={currentModel}
      isCurrentModelConfigured={currentModelConfigured}
      onSelectModel={handleSelect}
      onClose={handleClose}
    />
  );
}

export async function startModelBrowser(options: ModelBrowserOptions = {}): Promise<ModelBrowserResult> {
  if (!getPlatform().terminal.stdin.isTerminal()) {
    log.raw.error("Error: Requires interactive terminal.");
    return { code: 1 };
  }

  const runtimeConfig = await createRuntimeConfigManager();
  const runtimeSnapshot = await runtimeConfig.sync();
  const currentModel = options.currentModel ?? runtimeSnapshot.model;
  const currentModelConfigured = options.currentModelConfigured ??
    (runtimeSnapshot.modelConfigured === true);
  const endpoint = options.endpoint ?? runtimeSnapshot.endpoint;
  const initialTheme = setCurrentThemeName(runtimeConfig.getTheme());
  let selectedModel: string | undefined;

  const { waitUntilExit } = render(
    <ThemeProvider initialTheme={initialTheme}>
      <ModelBrowserApp
        endpoint={endpoint}
        currentModel={currentModel}
        currentModelConfigured={currentModelConfigured}
        onSelect={(model) => {
          selectedModel = model;
        }}
        onCancel={() => {
          // No-op
        }}
      />
    </ThemeProvider>
  );

  await waitUntilExit();
  return { code: 0, selectedModel };
}
