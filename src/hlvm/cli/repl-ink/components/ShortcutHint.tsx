import React, { useMemo } from "react";
import { Text } from "ink";
import { useSemanticColors } from "../../theme/index.ts";
import { getDisplay, registry } from "../keybindings/index.ts";

interface ShortcutHintProps {
  bindingId: string;
  label?: string;
  prefix?: string;
  tone?: "muted" | "active";
}

export function ShortcutHint(
  { bindingId, label, prefix, tone = "muted" }: ShortcutHintProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const binding = useMemo(
    () => registry.getAll().find((entry) => entry.id === bindingId),
    [bindingId],
  );

  if (!binding) return null;

  const keyColor = tone === "active" ? sc.footer.status.active : sc.text.primary;
  const labelColor = tone === "active" ? sc.text.secondary : sc.text.muted;
  const display = getDisplay(binding);
  const text = label ?? binding.label.toLowerCase();

  return (
    <>
      {prefix && <Text color={labelColor}>{prefix}</Text>}
      <Text color={keyColor}>{display}</Text>
      <Text color={labelColor}>{` ${text}`}</Text>
    </>
  );
}
