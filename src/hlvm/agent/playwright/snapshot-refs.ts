export interface PlaywrightSnapshotRef {
  ref: string;
  role?: string;
  name?: string;
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
}

const SNAPSHOT_REF_LINE_RE =
  /^\s*-\s+(?<role>[a-z][a-z0-9_-]*)(?:\s+(?<quote>["'])(?<name>.*?)\k<quote>)?(?<attrs>(?:\s+\[[^\]]+\])*)(?::.*)?$/i;
const SNAPSHOT_ATTR_RE = /\[([^\]]+)\]/g;

export function normalizePlaywrightRef(ref: unknown): string {
  return typeof ref === "string" ? ref.trim() : "";
}

export function buildPlaywrightRefLocator(ref: string): string {
  return `aria-ref=${ref}`;
}

function parseBooleanAttribute(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

export function parsePlaywrightSnapshotRefs(
  snapshot: string,
): PlaywrightSnapshotRef[] {
  const refs: PlaywrightSnapshotRef[] = [];

  for (const line of snapshot.split("\n")) {
    const match = SNAPSHOT_REF_LINE_RE.exec(line);
    if (!match?.groups) continue;

    const attrText = match.groups.attrs ?? "";
    const attributes: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = SNAPSHOT_ATTR_RE.exec(attrText)) !== null) {
      const raw = attrMatch[1]?.trim();
      if (!raw) continue;
      const separator = raw.indexOf("=");
      if (separator < 0) {
        attributes[raw.toLowerCase()] = "true";
        continue;
      }
      const key = raw.slice(0, separator).trim().toLowerCase();
      const value = raw.slice(separator + 1).trim();
      attributes[key] = value;
    }

    const ref = normalizePlaywrightRef(attributes.ref);
    if (!ref) continue;

    const entry: PlaywrightSnapshotRef = {
      ref,
      role: match.groups.role?.trim(),
      name: match.groups.name?.trim() || undefined,
    };
    const disabled = parseBooleanAttribute(attributes.disabled);
    const checked = parseBooleanAttribute(attributes.checked);
    const expanded = parseBooleanAttribute(attributes.expanded);
    if (disabled != null) entry.disabled = disabled;
    if (checked != null) entry.checked = checked;
    if (expanded != null) entry.expanded = expanded;
    refs.push(entry);
  }

  return refs;
}
