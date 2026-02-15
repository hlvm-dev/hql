/**
 * Standalone Model Browser (Ink)
 *
 * Provides an interactive CLI UI for downloading and selecting models.
 */

import React, { useCallback, useRef } from "npm:react@18";
import { render, useApp } from "npm:ink@5";
import { ThemeProvider } from "../theme/index.ts";
import { ModelBrowser } from "./components/ModelBrowser.tsx";
import { getErrorMessage } from "../../../common/utils.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { log } from "../../api/log.ts";
import { config } from "../../api/config.ts";
import { normalizeModelId } from "../../../common/config/types.ts";

export interface ModelBrowserOptions {
  endpoint?: string;
  currentModel?: string;
}

export interface ModelBrowserResult {
  code: number;
  selectedModel?: string;
}

interface ModelBrowserAppProps {
  endpoint?: string;
  currentModel?: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

function ModelBrowserApp({ endpoint, currentModel, onSelect, onCancel }: ModelBrowserAppProps): React.ReactElement {
  const { exit } = useApp();
  const doneRef = useRef(false);

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
    const normalized = normalizeModelId(modelName);
    if (!normalized) return;
    try {
      await config.set("model", normalized);
    } catch (error) {
      log.raw.error(`Failed to set model: ${getErrorMessage(error)}`);
      finish();
      return;
    }
    finish(normalized);
  }, [finish]);

  const handleClose = useCallback(() => {
    finish();
  }, [finish]);

  return (
    <ModelBrowser
      endpoint={endpoint}
      currentModel={currentModel}
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

  const currentModel = options.currentModel ?? config.snapshot.model;
  const endpoint = options.endpoint ?? config.snapshot.endpoint;
  let selectedModel: string | undefined;

  const { waitUntilExit } = render(
    <ThemeProvider>
      <ModelBrowserApp
        endpoint={endpoint}
        currentModel={currentModel}
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
