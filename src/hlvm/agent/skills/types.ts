export type SkillSource = "user" | "bundled";

export interface SkillEntry {
  name: string;
  description: string;
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
