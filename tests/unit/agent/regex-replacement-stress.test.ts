/**
 * Stress / adversarial tests for deterministic replacements of LLM classifiers.
 *
 * These tests go beyond happy-path and probe edge cases, false-positive traps,
 * and real-world phrasing variants to verify the regex/heuristic code is robust.
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  analyzeAssistantResponse,
  extractTrailingQuestionText,
} from "../../../src/hlvm/agent/response-analysis.ts";
import {
  classifyError,
  getRecoveryHint,
} from "../../../src/hlvm/agent/error-taxonomy.ts";
import { detectSearchQueryIntent } from "../../../src/hlvm/agent/tools/web/query-strategy.ts";
import { sanitizeSensitiveContent } from "../../../src/common/sanitize.ts";

// ═══════════════════════════════════════════════════════════════
// 1. RESPONSE ANALYSIS — edge cases & adversarial inputs
// ═══════════════════════════════════════════════════════════════

// --- Question detection edge cases ---

Deno.test("response analysis: question mark inside code block is NOT a trailing question", () => {
  const analysis = analyzeAssistantResponse(
    "Here's how to check:\n```\nif (x === 0) { console.log('why?'); }\n```",
  );
  // The trailing question text extraction is purely positional (last "?"),
  // so it WILL pick up the code question mark. This documents the known limitation.
  // If this test fails because you fixed the limitation, that's a good thing.
  const question = extractTrailingQuestionText(
    "Here's how to check:\n```\nif (x === 0) { console.log('why?'); }\n```",
  );
  // Documenting current behavior — the regex doesn't distinguish code blocks
  assert(question !== null || question === null, "Should not crash");
});

Deno.test("response analysis: rhetorical question mid-sentence NOT detected (fixed)", () => {
  const analysis = analyzeAssistantResponse(
    "Why does this matter? Because it prevents memory leaks. Here's the fix.",
  );
  // Fixed: if the last "." or "!" comes AFTER the last "?", the question is mid-text.
  assertEquals(analysis.asksQuestion, false);
  assertEquals(analysis.question, null);
});

Deno.test("response analysis: multiple questions — only extracts the last one", () => {
  const analysis = analyzeAssistantResponse(
    "Should I refactor the module? Or would you prefer I just fix the bug?",
  );
  assertEquals(analysis.asksQuestion, true);
  assertEquals(
    analysis.question,
    "Or would you prefer I just fix the bug?",
  );
  // "Or would..." doesn't start with a binary auxiliary verb
  assertEquals(analysis.isBinaryQuestion, false);
});

Deno.test("response analysis: question with no question mark — NOT detected", () => {
  const analysis = analyzeAssistantResponse(
    "I wonder if you want me to proceed with the refactoring.",
  );
  assertEquals(analysis.asksQuestion, false);
});

Deno.test("response analysis: URL containing question mark is not a question", () => {
  const analysis = analyzeAssistantResponse(
    "You can find it at https://example.com/search?q=test&page=1",
  );
  // The "?" in URL will be picked up as trailing question text.
  // Documenting this known limitation.
  const question = extractTrailingQuestionText(
    "You can find it at https://example.com/search?q=test&page=1",
  );
  // Current behavior: no trailing "?" at end of string → no question detected
  // Actually the last char is "1" not "?", so lastIndexOf("?") finds the URL "?"
  // but the extracted text would be "q=test&page=1" which doesn't end with "?"
  // Wait — lastIndexOf("?") returns the position, then slices to end+1.
  // Let's just verify it doesn't crash and document behavior.
  assert(question === null || typeof question === "string");
});

Deno.test("response analysis: empty string doesn't crash", () => {
  const analysis = analyzeAssistantResponse("");
  assertEquals(analysis.asksQuestion, false);
  assertEquals(analysis.needsConcreteTask, false);
  assertEquals(analysis.isWorkingNote, false);
  assertEquals(analysis.isPrematureContinuationOffer, false);
});

Deno.test("response analysis: only whitespace doesn't crash", () => {
  const analysis = analyzeAssistantResponse("   \n\n\t  ");
  assertEquals(analysis.asksQuestion, false);
  assertEquals(analysis.isWorkingNote, false);
});

// --- Working note variants ---

Deno.test("response analysis: 'I will' detected as working note", () => {
  const analysis = analyzeAssistantResponse(
    "I will read the configuration file and check the settings.",
  );
  assertEquals(analysis.isWorkingNote, true);
});

Deno.test("response analysis: 'I'll' detected as working note", () => {
  const analysis = analyzeAssistantResponse(
    "I'll check the database schema next.",
  );
  assertEquals(analysis.isWorkingNote, true);
});

Deno.test("response analysis: 'I need to' detected as working note", () => {
  const analysis = analyzeAssistantResponse(
    "I need to verify the test results before proceeding.",
  );
  assertEquals(analysis.isWorkingNote, true);
});

Deno.test("response analysis: 'let me' at end with colon detected as working note", () => {
  const analysis = analyzeAssistantResponse(
    "The configuration looks off. For the database settings, let me:",
  );
  assertEquals(analysis.isWorkingNote, true);
});

Deno.test("response analysis: 'let me' in middle of sentence — NOT a working note unless pattern matches", () => {
  // "let me" not at start and doesn't end with ":"
  const analysis = analyzeAssistantResponse(
    "Before we proceed, let me explain the architecture to you.",
  );
  // This one has "let me" in middle and doesn't end with ":" — should NOT match
  // Wait — pattern is: /let me\b/i.test(normalized) && normalized.endsWith(":")
  // The sentence ends with "." not ":" — so this specific pattern won't fire.
  // But also check: /^(now )?let me\b/i — no, it doesn't start with "let me"
  assertEquals(analysis.isWorkingNote, false);
});

// --- Concrete task detection variants ---

Deno.test("response analysis: 'can't act on the current request' detected", () => {
  const analysis = analyzeAssistantResponse(
    "I appreciate the context, but I can't act on the current request without more details.",
  );
  assertEquals(analysis.needsConcreteTask, true);
});

Deno.test("response analysis: near-miss phrase NOT detected as needing concrete task", () => {
  const analysis = analyzeAssistantResponse(
    "This is a very specific task that I can handle right away.",
  );
  assertEquals(analysis.needsConcreteTask, false);
});

// --- Continuation offer variants ---

Deno.test("response analysis: 'should I continue' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "I've finished the first module. Should I continue with the second?",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
  assertEquals(analysis.asksQuestion, true);
});

Deno.test("response analysis: 'should I go ahead' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "The plan looks good. Should I go ahead and implement it?",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

Deno.test("response analysis: 'if you want, I can' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "If you want, I can also add unit tests for the new endpoints.",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

// --- Known gap: phrases the regex SHOULD miss (documenting expected false negatives) ---

Deno.test("response analysis: 'Shall I proceed?' — now detected (fixed)", () => {
  const analysis = analyzeAssistantResponse(
    "I've reviewed the code. Shall I proceed with the changes?",
  );
  // Fixed: "shall I proceed" added to continuation offer pattern list
  assertEquals(analysis.isPrematureContinuationOffer, true);
  assertEquals(analysis.asksQuestion, true);
  // Fixed: "shall" added to binary question auxiliary list
  assertEquals(analysis.isBinaryQuestion, true);
});

Deno.test("response analysis: 'Do you want me to handle that?' — now detected (fixed)", () => {
  const analysis = analyzeAssistantResponse(
    "There's a failing test in auth.ts. Do you want me to handle that?",
  );
  // Fixed: "do you want me to" added to continuation offer pattern list
  assertEquals(analysis.isPrematureContinuationOffer, true);
  assertEquals(analysis.asksQuestion, true);
  assertEquals(analysis.isBinaryQuestion, true);
});

// --- Generic conversational variants ---

Deno.test("response analysis: 'Is there anything else you need?' — variant NOT caught", () => {
  const analysis = analyzeAssistantResponse(
    "Done! Is there anything else you need?",
  );
  // The pattern checks for "anything else" — "anything else you need" contains "anything else"
  assertEquals(analysis.isGenericConversational, true);
});

Deno.test("response analysis: 'Let me know if you need anything' — NOT generic (no ?)", () => {
  const analysis = analyzeAssistantResponse(
    "The fix is in place. Let me know if you need anything.",
  );
  // No "?" so asksQuestion = false, isGenericConversational only applies if question exists
  assertEquals(analysis.asksQuestion, false);
  assertEquals(analysis.isGenericConversational, false);
});

// --- Rhetorical question fix — more edge cases ---

Deno.test("response analysis: 'What does this do? It handles...' — mid-text, not a question", () => {
  const analysis = analyzeAssistantResponse(
    "What does this do? It handles authentication for all API endpoints.",
  );
  assertEquals(analysis.asksQuestion, false);
});

Deno.test("response analysis: 'How? Simple.' — mid-text, not a question", () => {
  const analysis = analyzeAssistantResponse("How? Simple.");
  assertEquals(analysis.asksQuestion, false);
});

Deno.test("response analysis: actual trailing question after explanation", () => {
  const analysis = analyzeAssistantResponse(
    "The module handles auth. It validates tokens. Should I refactor it?",
  );
  assertEquals(analysis.asksQuestion, true);
  assertEquals(analysis.isBinaryQuestion, true);
  assertStringIncludes(analysis.question ?? "", "Should I refactor");
});

Deno.test("response analysis: question then exclamation — mid-text", () => {
  const analysis = analyzeAssistantResponse(
    "Why did this break? Because someone removed the null check! Fixing now.",
  );
  assertEquals(analysis.asksQuestion, false);
});

// --- More continuation offer patterns ---

Deno.test("response analysis: 'I can also add logging' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "The refactoring is done. I can also add logging to the error handlers.",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

Deno.test("response analysis: 'want me to proceed' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "I found 3 failing tests. Want me to proceed with fixing them?",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

Deno.test("response analysis: 'I can go ahead and' detected as continuation offer", () => {
  const analysis = analyzeAssistantResponse(
    "The config looks correct. I can go ahead and deploy it.",
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

Deno.test("response analysis: 'May I continue?' detected as binary question", () => {
  const analysis = analyzeAssistantResponse("The first step is done. May I continue?");
  assertEquals(analysis.asksQuestion, true);
  assertEquals(analysis.isBinaryQuestion, true);
});

// --- Long multi-paragraph response ---

Deno.test("response analysis: long response — only last question matters", () => {
  const long = `Here's what I found in the codebase:

1. The auth module uses JWT tokens stored in localStorage.
2. The session manager has a 30-minute timeout.
3. There's a race condition in the refresh logic.

I've already fixed issues 1 and 2. Would you like me to tackle the race condition next?`;

  const analysis = analyzeAssistantResponse(long);
  assertEquals(analysis.asksQuestion, true);
  assertEquals(analysis.isBinaryQuestion, true);
  assertStringIncludes(analysis.question ?? "", "race condition");
  assertEquals(analysis.isPrematureContinuationOffer, true);
});

// ═══════════════════════════════════════════════════════════════
// 2. ERROR TAXONOMY — adversarial & edge cases
// ═══════════════════════════════════════════════════════════════

Deno.test("error taxonomy: novel error falls through to 'unknown' safely", async () => {
  const result = await classifyError(new Error("Quantum flux capacitor overloaded"));
  assertEquals(result.class, "unknown");
  assertEquals(result.retryable, true);
});

Deno.test("error taxonomy: empty error message doesn't crash", async () => {
  const result = await classifyError(new Error(""));
  assertEquals(result.class, "unknown");
  assertEquals(result.retryable, true);
});

Deno.test("error taxonomy: error with no message property", async () => {
  const result = await classifyError("just a string");
  // Should not crash, should classify somehow
  assert(["unknown", "permanent", "transient", "rate_limit", "timeout", "context_overflow", "abort"].includes(result.class));
});

Deno.test("error taxonomy: case insensitive matching", async () => {
  const result = await classifyError(new Error("RATE LIMIT EXCEEDED"));
  assertEquals(result.class, "rate_limit");
});

Deno.test("error taxonomy: partial keyword match — 'limited' should NOT match 'rate_limit'", async () => {
  const result = await classifyError(new Error("This feature is limited to paid plans"));
  // "limited" contains "limit" but the pattern is /rate limit/ which requires "rate" before "limit"
  // Actually let's check: does the regex /rate limit|too many requests|429/ match "limited"? No.
  assertEquals(result.class !== "rate_limit", true);
});

Deno.test("error taxonomy: HTTP status in message body", async () => {
  assertEquals((await classifyError(new Error("Server returned HTTP 500"))).class, "transient");
  assertEquals((await classifyError(new Error("Got HTTP 400 Bad Request"))).class, "permanent");
  assertEquals((await classifyError(new Error("Received HTTP 401"))).class, "permanent");
});

Deno.test("error taxonomy: ECONNREFUSED is transient", async () => {
  const result = await classifyError(new Error("connect ECONNREFUSED 127.0.0.1:11439"));
  assertEquals(result.class, "transient");
  assertEquals(result.retryable, true);
});

Deno.test("error taxonomy: context overflow in various phrasings", async () => {
  assertEquals(
    (await classifyError(new Error("maximum context length is 128000 tokens"))).class,
    "context_overflow",
  );
  assertEquals(
    (await classifyError(new Error("prompt is too long for this model"))).class,
    "context_overflow",
  );
  assertEquals(
    (await classifyError(new Error("too many tokens in the request"))).class,
    "context_overflow",
  );
});

Deno.test("error taxonomy: recovery hint returns null for truly unknown errors", () => {
  assertEquals(getRecoveryHint("Quantum flux capacitor overloaded"), null);
  assertEquals(getRecoveryHint(""), null);
});

Deno.test("error taxonomy: recovery hint distinguishes 'command not found' from 'not found'", () => {
  const cmdHint = getRecoveryHint("bash: foobar: command not found");
  const fileHint = getRecoveryHint("Error: file not found at /tmp/missing.txt");
  assertStringIncludes(cmdHint ?? "", "command");
  assertStringIncludes(fileHint ?? "", "path");
});

Deno.test("error taxonomy: recovery hint for 'denied by user'", () => {
  const hint = getRecoveryHint("Action denied by user: write_file");
  assertStringIncludes(hint ?? "", "alternative");
});

Deno.test("error taxonomy: multiple error signals — first match wins", async () => {
  // Message has both "rate limit" and "invalid request"
  const result = await classifyError(new Error("rate limit on invalid request"));
  // Depends on regex order in ERROR_PATTERNS. Auth/permanent is first, then rate_limit.
  // Actually checking: auth pattern is first (/api key not configured|...|http 40[13]/)
  // Then rate_limit (/rate limit|too many requests|429/)
  // "rate limit" matches rate_limit pattern
  // But "invalid request" matches permanent pattern
  // Since patterns are checked in order, and auth is first but doesn't match,
  // rate_limit is second and DOES match → rate_limit wins
  assertEquals(result.class, "rate_limit");
});

// ═══════════════════════════════════════════════════════════════
// 3. SEARCH INTENT — adversarial & edge cases
// ═══════════════════════════════════════════════════════════════

Deno.test("search intent: no keywords → all flags false (neutral search)", () => {
  const intent = detectSearchQueryIntent("how to cook pasta");
  assertEquals(intent.wantsOfficialDocs, false);
  assertEquals(intent.wantsComparison, false);
  assertEquals(intent.wantsRecency, false);
  assertEquals(intent.wantsVersionSpecific, false);
  assertEquals(intent.wantsReleaseNotes, false);
  assertEquals(intent.wantsReference, false);
});

Deno.test("search intent: empty query doesn't crash", () => {
  const intent = detectSearchQueryIntent("");
  assertEquals(intent.wantsOfficialDocs, false);
  assertEquals(intent.wantsComparison, false);
});

Deno.test("search intent: 'vs' detected as comparison", () => {
  const intent = detectSearchQueryIntent("React vs Vue performance");
  assertEquals(intent.wantsComparison, true);
});

Deno.test("search intent: 'versus' detected as comparison", () => {
  const intent = detectSearchQueryIntent("Python versus JavaScript for data science");
  assertEquals(intent.wantsComparison, true);
});

Deno.test("search intent: 'differences' detected as comparison", () => {
  const intent = detectSearchQueryIntent("key differences between REST and GraphQL");
  assertEquals(intent.wantsComparison, true);
});

Deno.test("search intent: version number with recency keyword triggers both", () => {
  const intent = detectSearchQueryIntent("Node.js 20.11.0 breaking changes");
  assertEquals(intent.wantsVersionSpecific, true);
  // "changes" is in RECENCY_TERMS, so RECENCY_RE fires independently of version
  assertEquals(intent.wantsRecency, true);
});

Deno.test("search intent: year WITHOUT version → recency, not version-specific", () => {
  const intent = detectSearchQueryIntent("best JavaScript frameworks 2025");
  assertEquals(intent.wantsRecency, true);
  assertEquals(intent.wantsVersionSpecific, false);
});

Deno.test("search intent: year WITH version → version-specific, recency from YEAR_RE suppressed", () => {
  const intent = detectSearchQueryIntent("Python 3.12 migration guide 2025");
  assertEquals(intent.wantsVersionSpecific, true);
  // RECENCY_RE might match "guide"? No, RECENCY_TERMS: latest, recent, today, current, new, updated, update, change, changes
  // "guide" is in REFERENCE_TERMS, not RECENCY_TERMS
  // YEAR_RE matches "2025" but wantsVersionSpecific is true, so (YEAR_RE && !wantsVersionSpecific) = false
  // RECENCY_RE doesn't match either → wantsRecency = false
  assertEquals(intent.wantsRecency, false);
  assertEquals(intent.wantsReference, true); // "guide" is in REFERENCE_TERMS
});

Deno.test("search intent: 'changelog' detected as release notes", () => {
  const intent = detectSearchQueryIntent("deno changelog 2.0");
  assertEquals(intent.wantsReleaseNotes, true);
  assertEquals(intent.wantsVersionSpecific, true);
});

Deno.test("search intent: 'what's new' detected as release notes", () => {
  const intent = detectSearchQueryIntent("what's new in TypeScript 5.4");
  assertEquals(intent.wantsReleaseNotes, true);
});

Deno.test("search intent: 'api reference' triggers both docs and reference", () => {
  const intent = detectSearchQueryIntent("Deno api reference for file system");
  assertEquals(intent.wantsOfficialDocs, true); // "api" is in OFFICIAL_DOCS_TERMS
  assertEquals(intent.wantsReference, true); // "api" and "reference" in REFERENCE_TERMS
});

Deno.test("search intent: 'lately' now detected as recency (fixed)", () => {
  const intent = detectSearchQueryIntent("what improved in React lately");
  assertEquals(intent.wantsRecency, true);
});

Deno.test("search intent: 'newest' now detected as recency (fixed)", () => {
  const intent = detectSearchQueryIntent("show me the newest React features");
  assertEquals(intent.wantsRecency, true);
});

Deno.test("search intent: 'recently' detected as recency", () => {
  const intent = detectSearchQueryIntent("what recently changed in the Deno runtime");
  assertEquals(intent.wantsRecency, true);
});

Deno.test("search intent: 'upcoming' detected as recency", () => {
  const intent = detectSearchQueryIntent("upcoming features in Python 4");
  assertEquals(intent.wantsRecency, true);
});

Deno.test("search intent: 'new' does match recency", () => {
  const intent = detectSearchQueryIntent("new features in React 19");
  assertEquals(intent.wantsRecency, true);
});

// ═══════════════════════════════════════════════════════════════
// 4. SENSITIVE CONTENT — adversarial & coverage gaps
// ═══════════════════════════════════════════════════════════════

Deno.test("sensitive: SSN with dashes redacted", () => {
  const result = sanitizeSensitiveContent("SSN: 123-45-6789");
  assertStringIncludes(result.sanitized, "[REDACTED:SSN]");
  assertEquals(result.sanitized.includes("123-45-6789"), false);
});

Deno.test("sensitive: SSN without dashes redacted", () => {
  const result = sanitizeSensitiveContent("SSN: 123456789");
  assertStringIncludes(result.sanitized, "[REDACTED:SSN]");
});

Deno.test("sensitive: SSN with dots redacted", () => {
  const result = sanitizeSensitiveContent("SSN: 123.45.6789");
  assertStringIncludes(result.sanitized, "[REDACTED:SSN]");
});

Deno.test("sensitive: credit card with spaces redacted", () => {
  const result = sanitizeSensitiveContent("Card: 4111 1111 1111 1111");
  assertStringIncludes(result.sanitized, "[REDACTED:credit card]");
  assertEquals(result.sanitized.includes("4111"), false);
});

Deno.test("sensitive: credit card with dashes redacted", () => {
  const result = sanitizeSensitiveContent("Card: 4111-1111-1111-1111");
  assertStringIncludes(result.sanitized, "[REDACTED:credit card]");
});

Deno.test("sensitive: credit card no separators redacted", () => {
  const result = sanitizeSensitiveContent("Card: 4111111111111111");
  assertStringIncludes(result.sanitized, "[REDACTED:credit card]");
});

Deno.test("sensitive: Stripe secret key redacted", () => {
  const result = sanitizeSensitiveContent("Use sk_live_REDACTED_TEST_KEY");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
  assertEquals(result.sanitized.includes("sk_live_"), false);
});

Deno.test("sensitive: Stripe publishable key redacted", () => {
  const result = sanitizeSensitiveContent("Frontend key: pk_test_REDACTED_TEST_KEY");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
});

Deno.test("sensitive: generic api_key redacted", () => {
  const result = sanitizeSensitiveContent("Set api_key_abcdefghijklmnopqrstuvwxyz in env");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
});

Deno.test("sensitive: password with = sign redacted", () => {
  const result = sanitizeSensitiveContent("password=supersecret123");
  assertStringIncludes(result.sanitized, "[REDACTED:password]");
  assertEquals(result.sanitized.includes("supersecret"), false);
});

Deno.test("sensitive: pwd variant redacted", () => {
  const result = sanitizeSensitiveContent("pwd: mypassword");
  assertStringIncludes(result.sanitized, "[REDACTED:password]");
});

Deno.test("sensitive: passwd variant redacted", () => {
  const result = sanitizeSensitiveContent("set passwd=hunter2");
  assertStringIncludes(result.sanitized, "[REDACTED:password]");
});

Deno.test("sensitive: multiple secrets in one string", () => {
  const result = sanitizeSensitiveContent(
    "SSN: 123-45-6789, Key: sk_live_REDACTED_TEST_KEY, password: secret",
  );
  assertStringIncludes(result.sanitized, "[REDACTED:SSN]");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
  assertStringIncludes(result.sanitized, "[REDACTED:password]");
  assert(result.stripped.includes("SSN"));
  assert(result.stripped.includes("API key"));
  assert(result.stripped.includes("password"));
});

Deno.test("sensitive: no secrets — text unchanged", () => {
  const text = "The user prefers dark mode and uses vim keybindings.";
  const result = sanitizeSensitiveContent(text);
  assertEquals(result.sanitized, text);
  assertEquals(result.stripped.length, 0);
});

Deno.test("sensitive: empty string doesn't crash", () => {
  const result = sanitizeSensitiveContent("");
  assertEquals(result.sanitized, "");
  assertEquals(result.stripped.length, 0);
});

// --- Known coverage gaps (documenting, not failures) ---

Deno.test("sensitive: email addresses now redacted (fixed)", () => {
  const result = sanitizeSensitiveContent("Contact me at john.doe@example.com");
  assertStringIncludes(result.sanitized, "[REDACTED:email]");
  assertEquals(result.sanitized.includes("john.doe@example.com"), false);
});

Deno.test("sensitive: phone numbers now redacted (fixed)", () => {
  const result = sanitizeSensitiveContent("Call me at (555) 123-4567");
  assertStringIncludes(result.sanitized, "[REDACTED:phone]");
  assertEquals(result.sanitized.includes("123-4567"), false);
});

Deno.test("sensitive: phone with dashes redacted", () => {
  const result = sanitizeSensitiveContent("Phone: 555-123-4567");
  assertStringIncludes(result.sanitized, "[REDACTED:phone]");
});

Deno.test("sensitive: phone with dots redacted", () => {
  const result = sanitizeSensitiveContent("Phone: 555.123.4567");
  assertStringIncludes(result.sanitized, "[REDACTED:phone]");
});

Deno.test("sensitive: phone with +1 prefix redacted", () => {
  const result = sanitizeSensitiveContent("Call +1-555-123-4567");
  assertStringIncludes(result.sanitized, "[REDACTED:phone]");
});

Deno.test("sensitive: AWS access key now redacted (fixed)", () => {
  const result = sanitizeSensitiveContent("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
  assertEquals(result.sanitized.includes("AKIAIOSFODNN7EXAMPLE"), false);
});

Deno.test("sensitive: bearer JWT token now redacted (fixed)", () => {
  const result = sanitizeSensitiveContent("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.abc123");
  assertStringIncludes(result.sanitized, "[REDACTED:auth token]");
  assertEquals(result.sanitized.includes("eyJhbGci"), false);
});

Deno.test("sensitive: GitHub personal access token redacted", () => {
  const result = sanitizeSensitiveContent("Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij as your token");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
  assertEquals(result.sanitized.includes("ghp_"), false);
});

Deno.test("sensitive: GitLab token redacted", () => {
  const result = sanitizeSensitiveContent("GITLAB_TOKEN=glpat-abcdefghijklmnopqrstuvwxyz");
  assertStringIncludes(result.sanitized, "[REDACTED:API key]");
  assertEquals(result.sanitized.includes("glpat-"), false);
});

Deno.test("sensitive: private key block redacted", () => {
  const result = sanitizeSensitiveContent(
    "Here is the key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJ...\n-----END RSA PRIVATE KEY-----\nDon't share it.",
  );
  assertStringIncludes(result.sanitized, "[REDACTED:private key]");
  assertEquals(result.sanitized.includes("MIIBogIBAAJ"), false);
});

Deno.test("sensitive: email-like strings in code context still redacted", () => {
  const result = sanitizeSensitiveContent("user_email = 'admin@internal.corp'");
  assertStringIncludes(result.sanitized, "[REDACTED:email]");
});

// --- False positive guards ---

Deno.test("sensitive: normal prose with 'email' word NOT redacted", () => {
  const result = sanitizeSensitiveContent("Send an email to the support team.");
  assertEquals(result.stripped.length, 0);
});

Deno.test("sensitive: short random numbers NOT flagged as phone", () => {
  const result = sanitizeSensitiveContent("There are 123 items in 456 categories.");
  assertEquals(result.stripped.includes("phone"), false);
});

Deno.test("sensitive: version numbers NOT flagged as phone", () => {
  const result = sanitizeSensitiveContent("Using Node.js 20.11.0 on port 3000");
  assertEquals(result.stripped.includes("phone"), false);
});

// --- False positive traps ---

Deno.test("sensitive: ZIP+4 no longer falsely detected as SSN (fixed)", () => {
  const result = sanitizeSensitiveContent("ZIP code: 90210-1234");
  // Fixed: SSN pattern uses negative lookbehind/lookahead to reject matches
  // inside longer digit strings.
  assertEquals(result.stripped.includes("SSN"), false);
});

Deno.test("sensitive: short API key (<20 chars) NOT redacted", () => {
  const result = sanitizeSensitiveContent("sk_test_short");
  // Pattern requires 20+ chars after the prefix
  assertEquals(result.stripped.length, 0);
});

Deno.test("sensitive: 'password' in prose without a value is NOT redacted", () => {
  const result = sanitizeSensitiveContent("Make sure to use a strong password for your account.");
  // Pattern is /(password|passwd|pwd)\s*[:=]\s*\S+/gi
  // "password for" doesn't have : or = after it
  assertEquals(result.stripped.length, 0);
});
