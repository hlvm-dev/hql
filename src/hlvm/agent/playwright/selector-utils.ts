const PLAYWRIGHT_SELECTOR_ENGINE_RE = /^[a-z][a-z0-9_-]*=/i;

const PLAYWRIGHT_ROLE_NAMES = new Set([
  "button",
  "checkbox",
  "combobox",
  "heading",
  "link",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "tab",
  "textbox",
]);

const QUOTED_ROLE_SELECTOR_RE = /^([a-z][a-z0-9_-]*)\s+(['"])(.*?)\2$/i;

export function normalizePlaywrightSelector(selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return "";
  if (PLAYWRIGHT_SELECTOR_ENGINE_RE.test(trimmed)) return trimmed;

  const quotedRoleMatch = QUOTED_ROLE_SELECTOR_RE.exec(trimmed);
  if (quotedRoleMatch) {
    const role = quotedRoleMatch[1].toLowerCase();
    const name = quotedRoleMatch[3].trim();
    if (PLAYWRIGHT_ROLE_NAMES.has(role) && name.length > 0) {
      return `role=${role}[name=${JSON.stringify(name)}]`;
    }
  }

  const bareRole = trimmed.toLowerCase();
  if (PLAYWRIGHT_ROLE_NAMES.has(bareRole)) {
    return `role=${bareRole}`;
  }

  return trimmed;
}

export function buildPlaywrightSnapshotHint(snapshot: string): string {
  const hints = [
    "Prefer snapshot refs when available: pass ref from pw_snapshot to pw_click, pw_fill, pw_type, pw_hover, pw_content, pw_screenshot, or pw_download.",
    "If you do not use refs, use role/name from snapshot as selectors: role=button[name='Submit'], role=searchbox[name='Search'], text=Sign in.",
    'pw_click and pw_fill also accept shorthand like button "Submit", textbox "Email", checkbox "Remember me".',
  ];

  if (/\bsearchbox\b/i.test(snapshot)) {
    hints.push(
      "If this is a docs/help site and you need a concept, example, or tutorial, prefer the site searchbox before drilling through dense sidebars or API reference trees.",
    );
  }

  return hints.join(" ");
}
