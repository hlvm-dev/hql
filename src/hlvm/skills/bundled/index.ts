/**
 * Bundled Skills Index
 *
 * Exports all built-in skills that ship with HLVM.
 */

import type { SkillDefinition } from "../types.ts";
import { COMMIT_SKILL } from "./commit.ts";
import { TEST_SKILL } from "./test.ts";
import { REVIEW_SKILL } from "./review.ts";

const BUNDLED: readonly SkillDefinition[] = [
  COMMIT_SKILL,
  TEST_SKILL,
  REVIEW_SKILL,
];

export function getBundledSkills(): readonly SkillDefinition[] {
  return BUNDLED;
}
