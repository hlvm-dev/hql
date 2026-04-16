export function djb2Hash(str: string): number {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }

  return hash;
}

export function hashContent(content: string): string {
  return String(djb2Hash(content));
}
