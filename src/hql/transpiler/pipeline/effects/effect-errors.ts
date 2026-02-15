import { ValidationError } from "../../../../common/error.ts";
import * as IR from "../../type/hql_ir.ts";

export function toEffectValidationError(
  message: string,
  node: IR.IRNode,
): ValidationError {
  return new ValidationError(
    message,
    "effect check",
    undefined,
    undefined,
    {
      line: node.position?.line,
      column: node.position?.column,
      filePath: node.position?.filePath,
    },
  );
}

export function impureFunctionCallMessage(
  fnName: string,
  calleeName: string,
): string {
  return `Cannot call impure function '${calleeName}' from pure function '${fnName}'`;
}

export function unknownFunctionCallMessage(
  fnName: string,
  calleeName: string,
): string {
  return `Cannot call unknown function '${calleeName}' from pure function '${fnName}'`;
}

export function inlineFunctionCallMessage(fnName: string): string {
  return `Direct invocation of inline function expressions is not allowed in pure function '${fnName}'`;
}

export function dynamicFunctionCallMessage(fnName: string): string {
  return `Dynamic function call is not allowed in pure function '${fnName}'`;
}

export function unknownMemberCallMessage(
  fnName: string,
  memberPath: string,
): string {
  return `Unknown member call '${memberPath}' is not allowed in pure function '${fnName}'`;
}

export function sideEffectMemberCallMessage(
  fnName: string,
  memberPath: string,
): string {
  return `'${memberPath}' is not allowed in pure function '${fnName}' (side effect)`;
}

export function unknownMemberMethodMessage(
  fnName: string,
  methodName: string,
): string {
  return `Unknown member method '.${methodName}' is not allowed in pure function '${fnName}'`;
}

export function impureCallbackMessage(
  fnName: string,
  callbackDesc: string,
  methodName: string,
): string {
  return `Impure callback '${callbackDesc}' passed to '.${methodName}' in pure function '${fnName}'`;
}

export function mutatingMethodMessage(
  fnName: string,
  methodName: string,
): string {
  return `'.${methodName}' is a mutating method and not allowed in pure function '${fnName}'`;
}

export function impureConstructorMessage(
  fnName: string,
  ctorName: string,
): string {
  if (ctorName === "Date") {
    return `'new ${ctorName}()' is not allowed in pure function '${fnName}' (nondeterministic)`;
  }
  return `'new ${ctorName}()' is not allowed in pure function '${fnName}'`;
}

export function dynamicConstructorMessage(fnName: string): string {
  return `Dynamic constructor call is not allowed in pure function '${fnName}'`;
}
