import { createSdkLanguageModel } from "./src/hlvm/providers/sdk-runtime.ts";
import { generateText } from "ai";

try {
  const model = await createSdkLanguageModel({
    providerName: "claude-code",
    modelId: "claude-sonnet-4-5-20250929",
  });

  const result = await generateText({
    model,
    maxTokens: 1024,
    messages: [{ role: "user", content: "What is 2+2? One word only." }],
  });

  console.log("SUCCESS:", result.text);
} catch (e) {
  console.log("ERROR:", e.message);
  console.log("STATUS:", e.statusCode);
  console.log("FULL ERROR:", JSON.stringify(e, null, 2));

  // Try to get response body
  try {
    const responseText = await e.responseBody;
    console.log("RESPONSE:", responseText);
  } catch {}
}
