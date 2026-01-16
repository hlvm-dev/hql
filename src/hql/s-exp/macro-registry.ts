// src/hql/s-exp/macro-registry.ts - Further cleanup of user-level macro references
import { Logger } from "../../logger.ts";
import type { MacroFn } from "../environment.ts";
import { MacroError } from "../../common/error.ts";
import { getErrorMessage, setWithSanitized } from "../../common/utils.ts";
import { globalSymbolTable } from "../transpiler/symbol_table.ts";

export class MacroRegistry {
  private systemMacros = new Map<string, MacroFn>();
  private processedFiles = new Set<string>();
  private logger: Logger;

  constructor(verbose: boolean = false) {
    this.logger = new Logger(verbose);
    this.logger.debug("MacroRegistry initialized");
  }

  private assertPresent(
    value: unknown,
    errorMessage: string,
    macroName: string,
    filePath?: string,
  ): void {
    if (!value) {
      this.logger.error(errorMessage);
      throw new MacroError(errorMessage, macroName, filePath);
    }
  }

  /**
   * Define a system-level macro
   */
  defineSystemMacro(name: string, macroFn: MacroFn): void {
    this.assertPresent(
      name,
      "Cannot define system macro with empty name",
      "system-macro",
    );
    this.assertPresent(
      macroFn,
      `Cannot define system macro ${name} with null function`,
      name,
    );
    this.logger.debug(`Defining system macro: ${name}`);
    setWithSanitized(this.systemMacros, name, macroFn);

    // Add to global symbol table
    globalSymbolTable.set({
      name: name,
      kind: "macro",
      scope: "global",
      meta: { isCore: true },
    });
  }

  /**
   * Check if a macro is a system-level macro
   */
  isSystemMacro(name: string): boolean {
    return this.systemMacros.has(name);
  }

  /**
   * Mark a file as processed
   */
  markFileProcessed(filePath: string): void {
    if (!filePath) {
      this.logger.warn("Cannot mark empty file path as processed");
      return;
    }
    this.processedFiles.add(filePath);
    this.logger.debug(`Marked file as processed: ${filePath}`);
  }

  /**
   * Check if a file has been processed
   */
  hasProcessedFile(filePath: string): boolean {
    return this.processedFiles.has(filePath);
  }

  /**
   * Import a macro from another file (only supported for system macros)
   */
  importMacro(
    fromFile: string,
    macroName: string,
    toFile: string,
    aliasName?: string,
  ): boolean {
    try {
      this.assertPresent(
        fromFile,
        "Source file path required for importing macro",
        macroName,
        toFile,
      );
      this.assertPresent(
        macroName,
        "Cannot import macro with empty name",
        "import-macro",
        toFile,
      );
      this.assertPresent(
        toFile,
        "Target file path required for importing macro",
        macroName,
        fromFile,
      );

      if (fromFile === toFile) {
        this.logger.debug(`Skipping self-import of ${macroName} (same file)`);
        return true;
      }

      if (!this.systemMacros.has(macroName)) {
        const message =
          `Macro ${macroName} is not a system macro and cannot be imported`;
        this.logger.warn(message);
        throw new MacroError(message, macroName, fromFile);
      }

      const importName = aliasName || macroName;
      this.logger.debug(
        `Importing system macro ${macroName}${
          aliasName ? ` as ${aliasName}` : ""
        }`,
      );

      globalSymbolTable.set({
        name: importName,
        kind: "macro",
        scope: "local",
        aliasOf: aliasName ? macroName : undefined,
        isImported: true,
        meta: { importedInFile: toFile, isSystemMacro: true },
      });

      return true;
    } catch (error) {
      const message = error instanceof MacroError
        ? error.message
        : `Failed to import macro ${macroName} from ${fromFile} to ${toFile}: ${
          getErrorMessage(error)
        }`;
      this.logger.warn(message);
      return false;
    }
  }

  /**
   * Check if a macro is defined
   */
  hasMacro(name: string): boolean {
    if (!name) return false;
    if (this.systemMacros.has(name)) {
      this.logger.debug(`Found system macro: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get a macro function by name
   */
  getMacro(name: string): MacroFn | undefined {
    if (!name) {
      this.logger.warn("Cannot get macro with empty name");
      return undefined;
    }

    // Single lookup optimization (KISS: avoid has() + get() double lookup)
    const macro = this.systemMacros.get(name);
    if (macro !== undefined) {
      this.logger.debug(`Getting system macro: ${name}`);
      return macro;
    }

    this.logger.debug(`Macro ${name} not found in system macros`);
    return undefined;
  }
}
