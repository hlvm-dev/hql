export type RuntimeMessageKind = "directive" | "notice" | "update";

function runtimeMessageLabel(kind: RuntimeMessageKind): string {
  switch (kind) {
    case "directive":
      return "Runtime Directive";
    case "notice":
      return "Runtime Notice";
    case "update":
      return "Runtime Update";
  }
}

export function formatRuntimeMessage(
  kind: RuntimeMessageKind,
  body: string,
): string {
  return `[${runtimeMessageLabel(kind)}]\n${body}`;
}

export function runtimeDirective(body: string): string {
  return formatRuntimeMessage("directive", body);
}

export function runtimeNotice(body: string): string {
  return formatRuntimeMessage("notice", body);
}

export function runtimeUpdate(body: string): string {
  return formatRuntimeMessage("update", body);
}
