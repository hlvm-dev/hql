import { listModels } from "./src/hlvm/providers/claude-code/api.ts";

try {
  const models = await listModels();
  console.log("Models count:", models.length);
  console.log("Models available:", models.map(m => m.id).join(", "));
  console.log("Full models:", JSON.stringify(models, null, 2));
} catch (e) {
  console.log("ERROR listing models:", e.message);
  console.log("FULL ERROR:", JSON.stringify(e, null, 2));
}
