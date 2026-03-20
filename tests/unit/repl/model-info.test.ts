import { assertEquals } from "jsr:@std/assert";
import {
  __testOnlyResetModelInfoCache,
  fetchModelInfo,
} from "../../../src/hlvm/cli/repl-ink/utils/model-info.ts";
import { withRuntimeHostServer } from "../../shared/light-helpers.ts";

Deno.test({
  name: "model info: cache stays bounded and evicts least-recently-used models",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    __testOnlyResetModelInfoCache();

    const requestCounts = new Map<string, number>();

    await withRuntimeHostServer(async (req, authToken) => {
      assertEquals(req.headers.get("Authorization"), `Bearer ${authToken}`);

      const url = new URL(req.url);
      if (!url.pathname.startsWith("/api/models/")) {
        return new Response("Not found", { status: 404 });
      }

      const key = url.pathname;
      requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);

      const parts = url.pathname.split("/");
      const provider = decodeURIComponent(parts[3] ?? "ollama");
      const name = decodeURIComponent(parts[4] ?? "");

      return Response.json({
        name: `${provider}/${name}`,
        displayName: name,
        capabilities: ["generate", "chat"],
      });
    }, async () => {
      await fetchModelInfo("ollama/model-a");
      await fetchModelInfo("ollama/model-a");

      assertEquals(requestCounts.get("/api/models/ollama/model-a"), 1);

      for (let index = 0; index < 140; index++) {
        await fetchModelInfo(`ollama/model-${index}`);
      }

      await fetchModelInfo("ollama/model-a");
      assertEquals(requestCounts.get("/api/models/ollama/model-a"), 2);
    });
  },
});
