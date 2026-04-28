interface AssistantResponseAnalysis {
  asksQuestion: boolean;
  question: string | null;
  isBinaryQuestion: boolean;
  isGenericConversational: boolean;
  needsConcreteTask: boolean;
  isWorkingNote: boolean;
  isPrematureContinuationOffer: boolean;
}

function normalizeAssistantResponse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLikelyBinaryQuestion(question: string): boolean {
  return /^(would|should|could|can|do|does|did|will|is|are|am|have|has|had|shall|may)\b/i
    .test(question.trim());
}

function isGenericConversationalQuestion(question: string): boolean {
  return /(anything else|any other questions|how else can i help|what else can i help)/i
    .test(question);
}

function looksLikeNeedsConcreteTask(response: string): boolean {
  const normalized = normalizeAssistantResponse(response);
  return /(what concrete task do you want me to plan|what concrete task|what specific task|needs? a concrete task|more specific instructions|cannot act on the current request|can't act on the current request)/i
    .test(normalized);
}

function looksLikeWorkingNote(response: string): boolean {
  const normalized = normalizeAssistantResponse(response);
  if (!normalized) return false;
  if (/^(now )?let me\b/i.test(normalized)) return true;
  if (/^(i('| wi)ll|i need to)\b/i.test(normalized)) return true;
  if (/let me\b/i.test(normalized) && normalized.endsWith(":")) return true;
  return /^the page doesn't appear.*let me\b/i.test(normalized);
}

function looksLikePrematureContinuationOffer(response: string): boolean {
  const normalized = normalizeAssistantResponse(response);
  if (!normalized) return false;
  return /(if you'd like,? i can|would you like me to|should i continue|should i go ahead|if you want,? i can|shall i (?:proceed|go ahead|continue)|do you want me to|want me to (?:go ahead|proceed|continue)|i can (?:also|go ahead and))/i
    .test(normalized);
}

export function extractTrailingQuestionText(response: string): string | null {
  const normalized = normalizeAssistantResponse(response);
  const end = normalized.lastIndexOf("?");
  if (end < 0) return null;

  // If the last sentence-ending punctuation is a "." or "!" AFTER the last "?",
  // the question is mid-text (rhetorical), not a trailing user-directed question.
  const lastPeriod = normalized.lastIndexOf(".");
  const lastExclamation = normalized.lastIndexOf("!");
  if (lastPeriod > end || lastExclamation > end) return null;

  let start = end;
  while (start > 0) {
    const previous = normalized[start - 1];
    if (previous === "." || previous === "!" || previous === "?") break;
    start--;
  }

  const question = normalized.slice(start, end + 1).trim();
  return question.length > 1 ? question : null;
}

export function analyzeAssistantResponse(
  response: string,
): AssistantResponseAnalysis {
  const question = extractTrailingQuestionText(response);
  const isGenericConversational = question !== null &&
    isGenericConversationalQuestion(question);

  return {
    asksQuestion: question !== null,
    question,
    isBinaryQuestion: question !== null && isLikelyBinaryQuestion(question),
    isGenericConversational,
    needsConcreteTask: looksLikeNeedsConcreteTask(response),
    isWorkingNote: looksLikeWorkingNote(response),
    isPrematureContinuationOffer: looksLikePrematureContinuationOffer(response),
  };
}
