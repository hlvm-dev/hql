export function deriveDefaultSessionKey(workspace: string, model: string): string {
  return `default:${workspace}:${model}`;
}
