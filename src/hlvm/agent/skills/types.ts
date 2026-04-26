export type SkillSource = "user" | "bundled";

export interface ParsedSkillDefinition {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillEntry {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  filePath: string;
  baseDir: string;
  source: SkillSource;
}

export interface SkillDuplicate {
  name: string;
  winner: SkillEntry;
  shadowed: SkillEntry[];
}

export interface SkillSnapshot {
  skills: SkillEntry[];
  duplicates: SkillDuplicate[];
}
