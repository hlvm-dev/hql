/// <reference lib="dom" />
import { getExistingPage } from "./browser-manager.ts";

export type PlaywrightActionabilityCode =
  | "pw_element_not_found"
  | "pw_element_not_visible"
  | "pw_element_outside_viewport"
  | "pw_click_intercepted"
  | "pw_element_disabled";

export type PlaywrightVisualReason =
  | "not_visible"
  | "outside_viewport"
  | "click_intercepted";

export interface PlaywrightActionabilityFacts {
  matchedElements: number;
  visibleMatches: number;
  enabledMatches?: number;
  selector: string;
  interaction?: string;
  candidateHref?: string;
  elementRole?: string;
  elementName?: string;
  visualBlocker: boolean;
  visualReason?: PlaywrightVisualReason;
  interceptedByRole?: string;
  interceptedByName?: string;
}

export interface PlaywrightActionabilityResult {
  code?: PlaywrightActionabilityCode;
  facts: PlaywrightActionabilityFacts;
}

export interface PlaywrightElementSnapshot {
  visible: boolean;
  enabled: boolean;
  inViewport: boolean;
  candidateHref?: string;
  role?: string;
  name?: string;
  intercepted?: boolean;
  interceptedByRole?: string;
  interceptedByName?: string;
}

export const PLAYWRIGHT_VISUAL_ACTIONABILITY_CODES = new Set<
  PlaywrightActionabilityCode
>([
  "pw_element_not_visible",
  "pw_element_outside_viewport",
  "pw_click_intercepted",
]);

export function isPlaywrightVisualActionabilityCode(
  code?: string,
): code is Extract<PlaywrightActionabilityCode, "pw_element_not_visible" | "pw_element_outside_viewport" | "pw_click_intercepted"> {
  return !!code && PLAYWRIGHT_VISUAL_ACTIONABILITY_CODES.has(
    code as PlaywrightActionabilityCode,
  );
}

export function summarizePlaywrightActionability(options: {
  selector: string;
  interaction?: string;
  elements: PlaywrightElementSnapshot[];
}): PlaywrightActionabilityResult {
  const { selector, interaction, elements } = options;
  const matchedElements = elements.length;
  const visibleMatches = elements.filter((element) => element.visible).length;
  const enabledMatches = elements.filter((element) => element.enabled).length;
  const visibleInViewportMatches = elements.filter((element) =>
    element.visible && element.inViewport
  ).length;
  const representative = elements.find((element) => element.visible) ??
    elements[0];
  const uniqueHrefs = Array.from(new Set(
    elements.map((element) => element.candidateHref).filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    ),
  ));
  const intercepted = interaction === "click"
    ? elements.find((element) =>
      element.visible && element.inViewport && element.intercepted === true
    )
    : undefined;

  const facts: PlaywrightActionabilityFacts = {
    matchedElements,
    visibleMatches,
    enabledMatches,
    selector,
    ...(interaction ? { interaction } : {}),
    ...(uniqueHrefs.length === 1 ? { candidateHref: uniqueHrefs[0] } : {}),
    ...(representative?.role ? { elementRole: representative.role } : {}),
    ...(representative?.name ? { elementName: representative.name } : {}),
    visualBlocker: false,
  };

  if (matchedElements === 0) {
    return {
      code: "pw_element_not_found",
      facts,
    };
  }

  if (enabledMatches === 0) {
    return {
      code: "pw_element_disabled",
      facts,
    };
  }

  if (visibleMatches === 0) {
    return {
      code: "pw_element_not_visible",
      facts: {
        ...facts,
        visualBlocker: true,
        visualReason: "not_visible",
      },
    };
  }

  if (visibleInViewportMatches === 0) {
    return {
      code: "pw_element_outside_viewport",
      facts: {
        ...facts,
        visualBlocker: true,
        visualReason: "outside_viewport",
      },
    };
  }

  if (intercepted) {
    return {
      code: "pw_click_intercepted",
      facts: {
        ...facts,
        visualBlocker: true,
        visualReason: "click_intercepted",
        ...(intercepted.interceptedByRole
          ? { interceptedByRole: intercepted.interceptedByRole }
          : {}),
        ...(intercepted.interceptedByName
          ? { interceptedByName: intercepted.interceptedByName }
          : {}),
      },
    };
  }

  return { facts };
}

export async function analyzePlaywrightActionability(options: {
  sessionId?: string;
  selector: string;
  interaction?: string;
}): Promise<PlaywrightActionabilityResult | null> {
  const page = getExistingPage(options.sessionId);
  if (!page) return null;

  try {
    const elements = await page.locator(options.selector).evaluateAll(
      (nodes, interaction) => {
        const inferRole = (element: Element): string | undefined => {
          const explicitRole = element.getAttribute("role");
          if (explicitRole) return explicitRole.trim().toLowerCase();
          const tag = element.tagName.toLowerCase();
          if (tag === "a" && element.hasAttribute("href")) return "link";
          if (tag === "button") return "button";
          if (tag === "select") return "combobox";
          if (tag === "textarea") return "textbox";
          if (tag === "input") {
            const input = element as HTMLInputElement;
            const type = (input.type || "text").toLowerCase();
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "search") return "searchbox";
            if (
              [
                "button",
                "submit",
                "reset",
              ].includes(type)
            ) {
              return "button";
            }
            return "textbox";
          }
          return undefined;
        };

        const normalize = (value: string | null | undefined): string =>
          (value ?? "").replace(/\s+/g, " ").trim();

        const inferName = (element: Element): string | undefined => {
          const html = element as HTMLInputElement;
          const candidates = [
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("placeholder"),
            element.getAttribute("alt"),
            "value" in html ? html.value : undefined,
            element.textContent,
          ];
          for (const candidate of candidates) {
            const normalized = normalize(candidate);
            if (normalized) return normalized;
          }
          return undefined;
        };

        // deno-lint-ignore no-explicit-any
        return nodes.slice(0, 8).map((node) => {
          const element = node as Element;
          const htmlElement = element as HTMLElement;
          // deno-lint-ignore no-explicit-any
          const win = globalThis as any;
          const rect = htmlElement.getBoundingClientRect();
          const style = win.getComputedStyle(htmlElement);
          const visible = !htmlElement.hidden &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0;
          const enabled = !element.matches(":disabled") &&
            element.getAttribute("aria-disabled") !== "true";
          const inViewport = rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < win.innerHeight &&
            rect.left < win.innerWidth;
          const anchor = element.closest("a[href]") as HTMLAnchorElement | null;

          let intercepted = false;
          let interceptedByRole: string | undefined;
          let interceptedByName: string | undefined;
          if (
            interaction === "click" &&
            visible &&
            enabled &&
            inViewport
          ) {
            const centerX = Math.min(
              win.innerWidth - 1,
              Math.max(0, rect.left + rect.width / 2),
            );
            const centerY = Math.min(
              win.innerHeight - 1,
              Math.max(0, rect.top + rect.height / 2),
            );
            const topElement = win.document.elementFromPoint(
              centerX,
              centerY,
            );
            if (
              topElement &&
              topElement !== element &&
              !element.contains(topElement) &&
              !topElement.contains(element)
            ) {
              intercepted = true;
              interceptedByRole = inferRole(topElement);
              interceptedByName = inferName(topElement);
            }
          }

          return {
            visible,
            enabled,
            inViewport,
            candidateHref: normalize(anchor?.href),
            role: inferRole(element),
            name: inferName(element),
            intercepted,
            interceptedByRole,
            interceptedByName,
          };
        });
      },
      options.interaction,
    );

    return summarizePlaywrightActionability({
      selector: options.selector,
      interaction: options.interaction,
      elements,
    });
  } catch {
    return null;
  }
}
