/**
 * Footer Hint Component
 *
 * Persistent hint showing available shortcuts below input line.
 * Helps users discover keyboard shortcuts.
 */

import React, { useState, useEffect } from "npm:react@18";
import { Text, Box } from "npm:ink@5";

export function FooterHint(): React.ReactElement {
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    const fetchModel = async () => {
      const configApi = (globalThis as Record<string, unknown>).config as {
        get: (key: string) => Promise<unknown>;
      } | undefined;

      if (configApi?.get) {
        try {
          const m = await configApi.get("model");
          if (typeof m === "string") {
            setModel(m.replace("ollama/", ""));
          }
        } catch {
          // ignore
        }
      }
    };
    fetchModel();
  }, []);

  return (
    <Box marginLeft={5} flexDirection="row" justifyContent="space-between">
      <Text dimColor>
        Ctrl+P commands | Tab complete | Ctrl+R history | Ctrl+L clear
      </Text>
      {model && <Text dimColor>🤖 {model}</Text>}
    </Box>
  );
}
