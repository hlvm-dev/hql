function detectTerminal(): string {
  return process.env.TERM_PROGRAM ??
    (process.env.TMUX ? "tmux" : process.env.TERM ?? "unknown");
}

export const env = {
  terminal: detectTerminal(),
};
