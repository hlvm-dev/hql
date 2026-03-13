/**
 * Live conformance smoke tests for multimodal attachment pipeline.
 *
 * Requires ANTHROPIC_API_KEY env var. Excluded from `deno task test:unit`.
 * Run manually: deno test --allow-all tests/e2e/attachment-conformance.test.ts
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SKIP_REASON = ANTHROPIC_API_KEY
  ? null
  : "ANTHROPIC_API_KEY not set — skipping live attachment conformance tests";

/** Minimal Anthropic Messages API call for conformance testing. */
async function anthropicChat(
  model: string,
  messages: unknown[],
): Promise<{ content: Array<{ text: string }>; stop_reason: string }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }
  return await response.json();
}

/** 1×1 red PNG pixel as base64. */
const RED_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

/** 1×1 blue PNG pixel as base64 (different from red). */
const BLUE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";

Deno.test({
  name: "attachment conformance: single image with claude-sonnet-4-5-20250929",
  ignore: !!SKIP_REASON,
  async fn() {
    const result = await anthropicChat("claude-sonnet-4-5-20250929", [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: RED_PIXEL_PNG,
            },
          },
          { type: "text", text: "What color is this pixel? Reply with just the color name." },
        ],
      },
    ]);
    assertEquals(result.stop_reason, "end_turn");
    assertStringIncludes(result.content[0]!.text.toLowerCase(), "red");
  },
});

Deno.test({
  name: "attachment conformance: multi-image comparison",
  ignore: !!SKIP_REASON,
  async fn() {
    const result = await anthropicChat("claude-sonnet-4-5-20250929", [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: RED_PIXEL_PNG,
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: BLUE_PIXEL_PNG,
            },
          },
          {
            type: "text",
            text: "I sent two images. What are the colors? Reply with just the two color names.",
          },
        ],
      },
    ]);
    assertEquals(result.stop_reason, "end_turn");
    const text = result.content[0]!.text.toLowerCase();
    assertStringIncludes(text, "red");
    assertStringIncludes(text, "blue");
  },
});

Deno.test({
  name: "attachment conformance: tools + image combined",
  ignore: !!SKIP_REASON,
  async fn() {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 256,
        tools: [
          {
            name: "describe_color",
            description: "Describe the dominant color of an image",
            input_schema: {
              type: "object",
              properties: { color: { type: "string" } },
              required: ["color"],
            },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: RED_PIXEL_PNG,
                },
              },
              {
                type: "text",
                text: "Use the describe_color tool to report the color of this image.",
              },
            ],
          },
        ],
      }),
    });
    assertEquals(response.ok, true);
    const body = await response.json();
    // Should either use the tool or provide text — both are valid
    assertEquals(body.content.length > 0, true);
  },
});

Deno.test({
  name: "attachment conformance: PDF attachment with claude-sonnet",
  ignore: !!SKIP_REASON,
  async fn() {
    // Minimal valid PDF (empty page)
    const minimalPdfBase64 = btoa(
      "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
        "0000000058 00000 n \n0000000115 00000 n \n" +
        "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
    );

    const result = await anthropicChat("claude-sonnet-4-5-20250929", [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: minimalPdfBase64,
            },
          },
          {
            type: "text",
            text: "What does this PDF contain? Reply briefly.",
          },
        ],
      },
    ]);
    assertEquals(result.stop_reason, "end_turn");
    assertEquals(result.content.length > 0, true);
  },
});

Deno.test({
  name: "attachment conformance: non-vision model rejects image gracefully",
  ignore: !!SKIP_REASON,
  async fn() {
    // Use haiku which may not support images, or test that the API at least responds
    // This tests the error path — the API should return a structured error, not crash
    try {
      await anthropicChat("claude-3-5-haiku-20241022", [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: RED_PIXEL_PNG,
              },
            },
            { type: "text", text: "What color?" },
          ],
        },
      ]);
      // If it succeeds, that's fine too — haiku may support vision
    } catch (error) {
      // API should return a structured error (400/422), not 500
      assertStringIncludes(String(error), "Anthropic API");
      assertEquals(String(error).includes("500") === false, true);
    }
  },
});
