// src/transpiler/syntax/enum.ts

import * as IR from "../type/hql_ir.ts";
import type { ListNode, SymbolNode } from "../type/hql_ast.ts";
import { TransformError, ValidationError } from "../../common/error.ts";
import { perform } from "../../common/error.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import { globalLogger as logger } from "../../logger.ts";
import { extractMetaSourceLocation, withSourceLocationOpts } from "../utils/source_location_utils.ts";
import type { HQLNode } from "../type/hql_ast.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";

export function parseEnumCase(
  caseList: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IREnumCase {
  return perform(
    () => {
      // Validate case list format
      if (
        caseList.elements.length < 2 ||
        caseList.elements[0].type !== "symbol" ||
        (caseList.elements[0] as SymbolNode).name !== "case" ||
        caseList.elements[1].type !== "symbol"
      ) {
        throw new TransformError(
          "Invalid enum case format. Expected (case CaseName ...)",
          "enum case format",
          withSourceLocationOpts({ phase: "case parse" }, caseList),
        );
      }

      const caseNameNode = caseList.elements[1] as SymbolNode;
      const caseName = caseNameNode.name;

      // Create the basic enum case
      const caseId: IR.IRIdentifier = {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(caseName),
      };
      copyPosition(caseNameNode, caseId);

      const enumCase: IR.IREnumCase = {
        type: IR.IRNodeType.EnumCase,
        id: caseId,
      };

      // Check if this case has additional elements (raw value or associated values)
      if (caseList.elements.length > 2) {
        const thirdElement = caseList.elements[2];

        // If the third element is a symbol (not a literal), treat remaining elements as associated value names
        // Syntax: (case Success value message) creates associated values: value, message
        if (thirdElement.type === "symbol") {
          const associatedValues: IR.IREnumAssociatedValue[] = [];
          for (let i = 2; i < caseList.elements.length; i++) {
            const elem = caseList.elements[i];
            if (elem.type === "symbol") {
              const paramName = (elem as SymbolNode).name;
              associatedValues.push({
                name: paramName,
              });
            }
          }

          if (associatedValues.length > 0) {
            enumCase.associatedValues = associatedValues;
            enumCase.hasAssociatedValues = true;
            logger.debug(
              `Enum case ${caseName} has ${associatedValues.length} associated values`,
            );
          }
        } else {
          // Treat the extra element as a raw value (literal)
          // Syntax: (case Ok 200) where 200 is the raw value
          const rawValueNode = caseList.elements[2];
          enumCase.rawValue = transformNode(rawValueNode, currentDir);
          logger.debug(`Enum case ${caseName} has raw value`);
        }
      }

      return enumCase;
    },
    "parseEnumCase",
    TransformError,
    [caseList],
  );
}

/**
 * Transform an enum declaration to IR.
 * Example: (enum StatusCode (case ok 200) (case notFound 404))
 */
export function transformEnumDeclaration(
  list: ListNode,
  currentDir: string,
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
): IR.IRNode {
  return perform(
    () => {
      logger.debug("Transforming enum declaration");

      // Validate enum syntax: at least a name and one case
      if (list.elements.length < 2) {
        throw new ValidationError(
          "enum requires a name and at least one case",
          "enum definition",
          "name and cases",
          { actualType: `${list.elements.length - 1} arguments`, ...extractMetaSourceLocation(list) },
        );
      }

      // Extract enum name and raw type
      const nameNode = list.elements[1];
      let enumName: string;
      let rawType: string | null = null;

      if (nameNode.type === "symbol") {
        const symbolName = (nameNode as SymbolNode).name;
        // If the name token contains a colon, split it up
        if (symbolName.includes(":")) {
          const parts = symbolName.split(":");
          enumName = parts[0].trim();
          rawType = parts[1].trim();
          logger.debug(
            `Detected enum with raw type (embedded): ${enumName}: ${rawType}`,
          );
        } else {
          enumName = symbolName;
          logger.debug(`Detected simple enum: ${enumName}`);
        }
      } else {
        throw new ValidationError(
          "Enum name must be a symbol",
          "enum name",
          "symbol",
          nameNode.type,
        );
      }

      // Determine where enum cases begin.
      // If rawType is not yet set, check if the next token is a symbol representing the raw type.
      let caseStartIndex = 2;
      if (!rawType && list.elements.length >= 3) {
        const potentialTypeNode = list.elements[2];
        if (potentialTypeNode.type === "symbol") {
          // Optionally you could validate the token against allowed types (e.g. "Int", "Double", etc.)
          rawType = (potentialTypeNode as SymbolNode).name.trim();
          logger.debug(`Detected enum raw type (separate token): ${rawType}`);
          caseStartIndex = 3;
        }
      }

      // Process enum cases: cases start at caseStartIndex
      const cases: IR.IREnumCase[] = [];
      const caseElements = list.elements.slice(caseStartIndex);

      for (const element of caseElements) {
        // Each case must be a list starting with "case" and at least one argument (the case name)
        if (element.type !== "list") {
          throw new ValidationError(
            "Enum cases must be lists starting with 'case'",
            "enum case",
            "list",
            element.type,
          );
        }

        // Use the enum handler module to parse cases
        const enumCase = parseEnumCase(
          element as ListNode,
          currentDir,
          transformNode,
        );
        cases.push(enumCase);
      }

      if (cases.length === 0) {
        throw new ValidationError(
          "Enum must define at least one case",
          "enum definition",
          "at least one case",
          "no cases defined",
        );
      }

      // Build the final enum declaration IR node.
      const enumId: IR.IRIdentifier = {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(enumName),
      };
      copyPosition(nameNode, enumId);

      const enumDeclaration: IR.IREnumDeclaration = {
        type: IR.IRNodeType.EnumDeclaration,
        id: enumId,
        cases,
      };

      if (rawType) {
        enumDeclaration.rawType = rawType;
      }

      if (cases.some((c) => c.hasAssociatedValues)) {
        enumDeclaration.hasAssociatedValues = true;
      }

      return enumDeclaration;
    },
    "transformEnum",
    TransformError,
    [list],
  );
}

/**

/**
 * Creates a JS object-based implementation for a simple enum
 */
/**
 * Creates a class-based implementation for an enum with associated values
 */
/**
 * Create the 'is' method for enum classes
 */
/**
 * Create the 'getValue' method for enum classes
 */
/**
 * Create a factory method for an enum case
 */
