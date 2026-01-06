/**
 * HQL Ink REPL - Rich Banner Component
 * Matches the old REPL's comprehensive startup display
 */

import React from "npm:react@18";
import { Box, Text } from "npm:ink@5";
import { version as VERSION } from "../../../../mod.ts";

const LOGO = `
 ██╗  ██╗ ██████╗ ██╗
 ██║  ██║██╔═══██╗██║
 ███████║██║   ██║██║
 ██╔══██║██║▄▄ ██║██║
 ██║  ██║╚██████╔╝███████╗
 ╚═╝  ╚═╝ ╚══▀▀═╝ ╚══════╝`;

interface BannerProps {
  jsMode: boolean;
  loading: boolean;
  memoryNames: string[];
  aiExports: string[];
  readyTime: number;
  errors: string[];
}

export function Banner({ jsMode, loading, memoryNames, aiExports, readyTime, errors }: BannerProps): React.ReactElement {
  // Format memory display
  const memoryDisplay = memoryNames.length > 0
    ? memoryNames.length <= 5
      ? memoryNames.join(", ")
      : `${memoryNames.slice(0, 5).join(", ")}... +${memoryNames.length - 5} more`
    : "empty — def/defn auto-save here";

  // Format AI display
  const aiDisplay = aiExports.length > 0
    ? `${aiExports.join(", ")} (auto-imported from @hql/ai)`
    : "not available — install @hql/ai";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Logo */}
      <Text color="#663399" bold>{LOGO}</Text>

      {/* Version + tagline - SICP red accent */}
      <Text color="red">Version {VERSION} • Lisp-like language for modern JavaScript</Text>
      <Text> </Text>

      {jsMode ? (
        // JavaScript polyglot mode banner
        <>
          <Box>
            <Text color="green">Mode:</Text>
            <Text> </Text>
            <Text color="cyan">HQL + JavaScript</Text>
            <Text> </Text>
            <Text dimColor>(polyglot)</Text>
          </Box>
          <Text dimColor>  (expr) → HQL    |    expr → JavaScript</Text>
          <Text> </Text>
          <Text color="green">Examples:</Text>
          <Box>
            <Text>  </Text>
            <Text color="cyan">let x = 10</Text>
            <Text>                 </Text>
            <Text dimColor>→ JavaScript variable</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(+ x 5)</Text>
            <Text>                    </Text>
            <Text dimColor>→ HQL using JS var</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">const add = (a,b) =&gt; a+b</Text>
            <Text>   </Text>
            <Text dimColor>→ JS arrow function</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(add 3 4)</Text>
            <Text>                  </Text>
            <Text dimColor>→ HQL calling JS fn</Text>
          </Box>
        </>
      ) : (
        // Pure HQL mode banner
        <>
          <Text color="green">Quick Start:</Text>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(+ 1 2)</Text>
            <Text>                    </Text>
            <Text dimColor>→ Simple math</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(fn add [x y] (+ x y))</Text>
            <Text>    </Text>
            <Text dimColor>→ Define function</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(add 10 20)</Text>
            <Text>                </Text>
            <Text dimColor>→ Call function</Text>
          </Box>
          <Text> </Text>
          <Text color="green">AI (requires @hql/ai):</Text>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(import [ask] from "@hql/ai")</Text>
          </Box>
          <Box>
            <Text>  </Text>
            <Text color="cyan">(await (ask "Hello"))</Text>
            <Text>      </Text>
            <Text dimColor>→ AI response</Text>
          </Box>
        </>
      )}

      <Text> </Text>

      {/* Memory status */}
      <Box>
        <Text color="green">Memory:</Text>
        <Text> </Text>
        {memoryNames.length > 0 ? (
          <>
            <Text>{memoryDisplay}</Text>
            <Text> </Text>
            <Text>({memoryNames.length} definition{memoryNames.length === 1 ? "" : "s"})</Text>
          </>
        ) : (
          <Text dimColor>{memoryDisplay}</Text>
        )}
      </Box>

      {/* AI status */}
      <Box>
        <Text color="green">AI:</Text>
        <Text> </Text>
        {aiExports.length > 0 ? (
          <Text>{aiDisplay}</Text>
        ) : (
          <Text dimColor>{aiDisplay}</Text>
        )}
      </Box>

      {/* Function commands hint */}
      <Text dimColor>(memory) | (forget "x") | (inspect x) | (describe x) AI | (help)</Text>

      {/* Memory errors if any */}
      {errors.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Memory warnings:</Text>
          {errors.slice(0, 3).map((err, i) => (
            <Box key={i}><Text dimColor>  {err}</Text></Box>
          ))}
          {errors.length > 3 && (
            <Text dimColor>  ... and {errors.length - 3} more</Text>
          )}
        </Box>
      )}

      {/* Ready status */}
      {loading ? (
        <Text dimColor>Loading...</Text>
      ) : (
        <Text dimColor>Ready in {readyTime}ms</Text>
      )}
    </Box>
  );
}
