const STRIPPED_TAGS_RE =
  /<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs;

export function stripPromptXMLTags(content: string): string {
  return content.replace(STRIPPED_TAGS_RE, "").trim();
}
