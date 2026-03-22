/**
 * Prompt Module — barrel re-export.
 */

export { compilePrompt } from "./compiler.ts";
export {
  isWorkspaceTrusted,
  loadInstructionHierarchy,
  mergeInstructions,
  trustWorkspace,
} from "./instructions.ts";
export { EMPTY_INSTRUCTIONS } from "./types.ts";
export type {
  CompiledPrompt,
  InstructionHierarchy,
  InstructionSource,
  PromptCompilerInput,
  PromptMode,
  PromptSection,
  SectionManifestEntry,
} from "./types.ts";
