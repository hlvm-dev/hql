/**
 * HLVM Ink REPL - Premium Banner Component
 * SICP-inspired design with professional CLI aesthetics
 */

import React from "npm:react@18";
import { Box, Text } from "npm:ink@5";
import { version as VERSION } from "../../../../../mod.ts";
import type { SessionMeta } from "../../repl/session/types.ts";
import { useTheme } from "../../theme/index.ts";

// =============================================================================
// HLVM Premium Logo - Block-art design
// Colors: Logo = primary (SICP purple), Tagline = secondary (SICP red)
// =============================================================================

const LOGO_LINES = [
  "██╗  ██╗ ██╗      ██╗   ██╗ ███╗   ███╗",
  "██║  ██║ ██║      ██║   ██║ ████╗ ████║",
  "███████║ ██║      ██║   ██║ ██╔████╔██║",
  "██╔══██║ ██║      ╚██╗ ██╔╝ ██║╚██╔╝██║",
  "██║  ██║ ███████╗  ╚████╔╝  ██║ ╚═╝ ██║",
  "╚═╝  ╚═╝ ╚══════╝   ╚═══╝   ╚═╝     ╚═╝",
];

// Unicode symbols for professional look
const SYMBOLS = {
  lambda: "λ",      // SICP tribute - the iconic lambda
  bullet: "◆",      // Diamond bullet for status items
  arrow: "→",       // Arrow for examples
  separator: "─",   // Horizontal line
} as const;

interface BannerProps {
  jsMode: boolean;
  loading: boolean;
  memoryNames: string[];
  aiExports: string[];
  readyTime: number;
  errors: string[];
  session?: SessionMeta | null;
}

export function Banner({ jsMode, loading, memoryNames, aiExports, readyTime, errors, session }: BannerProps): React.ReactElement {
  const { color } = useTheme();

  // Format displays
  const memoryDisplay = memoryNames.length > 0
    ? memoryNames.length <= 3
      ? memoryNames.join(", ")
      : `${memoryNames.slice(0, 3).join(", ")}... +${memoryNames.length - 3}`
    : "empty — def/defn auto-save here";

  const aiDisplay = aiExports.length > 0
    ? aiExports.slice(0, 5).join(", ") + " (auto-imported)"
    : "not available";

  const sessionDisplay = session
    ? `${session.title} (${session.messageCount} msgs)`
    : "New session";

  // Separator line
  const separator = SYMBOLS.separator.repeat(42);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* ═══ LOGO ═══ */}
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <React.Fragment key={index}>
            <Text color={color("primary")} bold>{line}</Text>
          </React.Fragment>
        ))}
      </Box>

      {/* ═══ TAGLINE ═══ */}
      <Text color={color("secondary")} bold>HLVM {VERSION} • Runtime for HQL + JavaScript</Text>
      <Text> </Text>

      {/* ═══ QUICK START ═══ */}
      {jsMode ? (
        // JavaScript polyglot mode
        <>
          <Box>
            <Text color={color("secondary")} bold>{SYMBOLS.lambda} </Text>
            <Text color={color("success")} bold>Polyglot Mode</Text>
            <Text dimColor>  (expr) → HQL  |  expr → JS</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>let x = 10</Text>
            <Text>              </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> JS variable</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(+ x 5)</Text>
            <Text>                 </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> HQL with JS</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>const f = (a,b) =&gt; a+b</Text>
            <Text>  </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> JS function</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(f 3 4)</Text>
            <Text>                 </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> Call from HQL</Text>
          </Box>
        </>
      ) : (
        // Pure HQL mode
        <>
          <Box>
            <Text color={color("secondary")} bold>{SYMBOLS.lambda} </Text>
            <Text color={color("success")} bold>Quick Start</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(+ 1 2)</Text>
            <Text>                 </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> Simple math</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(fn add [x y] (+ x y))</Text>
            <Text> </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> Define function</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(add 10 20)</Text>
            <Text>             </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> Call function</Text>
          </Box>
          <Text> </Text>
          <Box>
            <Text color={color("secondary")} bold>{SYMBOLS.lambda} </Text>
            <Text color={color("success")} bold>AI</Text>
            <Text dimColor>  (import [ask] from "@hlvm/ai")</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color={color("accent")}>(await (ask "Hello"))</Text>
            <Text>   </Text>
            <Text color={color("secondary")}>{SYMBOLS.arrow}</Text><Text dimColor> AI response</Text>
          </Box>
        </>
      )}

      <Text> </Text>

      {/* ═══ STATUS SECTION ═══ */}
      <Box>
        <Text color={color("secondary")}>{SYMBOLS.bullet} </Text>
        <Text color={color("success")}>Memory   </Text>
        {memoryNames.length > 0 ? (
          <Text>{memoryDisplay} ({memoryNames.length})</Text>
        ) : (
          <Text dimColor>{memoryDisplay}</Text>
        )}
      </Box>
      <Box>
        <Text color={color("secondary")}>{SYMBOLS.bullet} </Text>
        <Text color={color("success")}>AI       </Text>
        {aiExports.length > 0 ? (
          <Text>{aiDisplay}</Text>
        ) : (
          <Text dimColor>{aiDisplay}</Text>
        )}
      </Box>
      <Box>
        <Text color={color("secondary")}>{SYMBOLS.bullet} </Text>
        <Text color={color("success")}>Session  </Text>
        {session ? (
          <Text>{sessionDisplay}</Text>
        ) : (
          <Text dimColor>{sessionDisplay}</Text>
        )}
      </Box>

      {/* ═══ MEMORY ERRORS ═══ */}
      {errors.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={color("warning")}>⚠ Memory warnings:</Text>
          {errors.slice(0, 3).map((err, i) => (
            <Box key={i}><Text dimColor>  {err}</Text></Box>
          ))}
          {errors.length > 3 && (
            <Text dimColor>  ... and {errors.length - 3} more</Text>
          )}
        </Box>
      )}

      <Text> </Text>

      {/* ═══ SEPARATOR & HINTS ═══ */}
      <Text dimColor>{separator}</Text>
      <Box>
        <Text dimColor>Ctrl+P</Text>
        <Text color={color("muted")}> commands </Text>
        <Text dimColor>│</Text>
        <Text color={color("muted")}> Tab </Text>
        <Text dimColor>complete</Text>
        <Text color={color("muted")}> │ </Text>
        <Text dimColor>Ctrl+R</Text>
        <Text color={color("muted")}> history</Text>
      </Box>

      {/* ═══ READY STATUS ═══ */}
      {loading ? (
        <Text dimColor>Loading...</Text>
      ) : (
        <Text dimColor>Ready in {readyTime}ms</Text>
      )}
    </Box>
  );
}
