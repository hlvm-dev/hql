/**
 * Opt-in source-authority comparison between the heuristic classifier and the local model.
 *
 * This is not CI-gating. It exists to help decide whether the LLM fallback is still earning
 * its keep on the current fixture corpus.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { classifySearchResultSource } from "../../src/hlvm/agent/tools/web/source-authority.ts";
import { classifySourceAuthorities } from "../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../src/hlvm/runtime/local-fallback.ts";
import {
  SOURCE_AUTHORITY_FIXTURES,
  type SourceAuthorityFixture,
} from "../unit/agent/source-authority-fixtures.ts";

type ClassStats = {
  count: number;
  agreement: number;
  heuristicAccuracy: number;
  llmAccuracy: number;
  uplift: number;
};

function summarizeByClass(
  fixtures: readonly SourceAuthorityFixture[],
  heuristicClasses: string[],
  llmClasses: string[],
): Record<string, ClassStats> {
  const classes = new Set(fixtures.map((fixture) => fixture.expectedClass));
  const summary: Record<string, ClassStats> = {};

  for (const sourceClass of classes) {
    const indexes = fixtures.flatMap((fixture, index) =>
      fixture.expectedClass === sourceClass ? [index] : []
    );
    const count = indexes.length;
    const agreementCount = indexes.filter((index) =>
      heuristicClasses[index] === llmClasses[index]
    ).length;
    const heuristicCorrect = indexes.filter((index) =>
      heuristicClasses[index] === fixtures[index].expectedClass
    ).length;
    const llmCorrect = indexes.filter((index) =>
      llmClasses[index] === fixtures[index].expectedClass
    ).length;

    summary[sourceClass] = {
      count,
      agreement: count === 0 ? 0 : agreementCount / count,
      heuristicAccuracy: count === 0 ? 0 : heuristicCorrect / count,
      llmAccuracy: count === 0 ? 0 : llmCorrect / count,
      uplift: count === 0 ? 0 : (llmCorrect - heuristicCorrect) / count,
    };
  }

  return summary;
}

const modelName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
const runEval = Deno.env.get("HLVM_RUN_SOURCE_AUTHORITY_EVAL") === "1";
let localModelAvailable = false;

if (runEval) {
  try {
    const res = await fetch("http://127.0.0.1:11439/api/tags");
    if (res.ok) {
      const data = await res.json();
      localModelAvailable = data.models?.some((m: { name: string }) =>
        m.name === modelName || m.name.startsWith(modelName)
      );
    }
  } catch {
    // Local model unavailable.
  }
}

Deno.test({
  name: "[E2E] source authority: heuristic vs local model report",
  ignore: !runEval || !localModelAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const heuristicClasses = SOURCE_AUTHORITY_FIXTURES.map((fixture) =>
      classifySearchResultSource(fixture.result).sourceClass
    );
    const llmResult = await classifySourceAuthorities(
      SOURCE_AUTHORITY_FIXTURES.map((fixture) => ({
        url: fixture.result.url ?? "",
        title: fixture.result.title,
        snippet: fixture.result.snippet ?? "",
      })),
    );
    const llmClasses = SOURCE_AUTHORITY_FIXTURES.map((_fixture, index) =>
      llmResult.results.find((result) => result.index === index)?.sourceClass ?? "other"
    );

    const heuristicCorrect = heuristicClasses.filter((sourceClass, index) =>
      sourceClass === SOURCE_AUTHORITY_FIXTURES[index].expectedClass
    ).length;
    const llmCorrect = llmClasses.filter((sourceClass, index) =>
      sourceClass === SOURCE_AUTHORITY_FIXTURES[index].expectedClass
    ).length;
    const agreementCount = heuristicClasses.filter((sourceClass, index) =>
      sourceClass === llmClasses[index]
    ).length;

    const report = {
      caseCount: SOURCE_AUTHORITY_FIXTURES.length,
      overallAgreement: agreementCount / SOURCE_AUTHORITY_FIXTURES.length,
      heuristicAccuracy: heuristicCorrect / SOURCE_AUTHORITY_FIXTURES.length,
      llmAccuracy: llmCorrect / SOURCE_AUTHORITY_FIXTURES.length,
      byClass: summarizeByClass(
        SOURCE_AUTHORITY_FIXTURES,
        heuristicClasses,
        llmClasses,
      ),
      cases: SOURCE_AUTHORITY_FIXTURES.map((fixture, index) => ({
        name: fixture.name,
        expected: fixture.expectedClass,
        heuristic: heuristicClasses[index],
        llm: llmClasses[index],
      })),
    };

    console.log(JSON.stringify(report, null, 2));
    assertEquals(report.caseCount, SOURCE_AUTHORITY_FIXTURES.length);
  },
});
