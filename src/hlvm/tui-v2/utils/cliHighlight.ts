export type CliHighlight = {
  highlight: (
    code: string,
    options?: { language?: string; ignoreIllegals?: boolean },
  ) => string;
  supportsLanguage: (language: string) => boolean;
};

let cliHighlightPromise: Promise<CliHighlight | null> | undefined;

async function loadCliHighlight(): Promise<CliHighlight | null> {
  try {
    const cliHighlight = await import("npm:cli-highlight@2.1.11");
    return {
      highlight: cliHighlight.highlight,
      supportsLanguage: cliHighlight.supportsLanguage,
    };
  } catch {
    return null;
  }
}

export function getCliHighlightPromise(): Promise<CliHighlight | null> {
  cliHighlightPromise ??= loadCliHighlight();
  return cliHighlightPromise;
}
