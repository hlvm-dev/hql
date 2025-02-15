// nreplServer.ts
import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import { evaluateAsync, parseHQL, Env, baseEnv, formatValue } from "./hql.ts";

// Create a persistent environment (the source of truth)
const persistentEnv = new Env({}, baseEnv);
persistentEnv.exports = {};

// Choose a port for the nREPL server
const PORT = 5100;
console.log(`HQL nREPL server running on http://localhost:${PORT}`);

// Create an HTTP server that listens for evaluation requests.
serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  
  try {
    // Expect the request body to be JSON with a "code" property.
    const { code } = await req.json();
    if (typeof code !== "string") {
      throw new Error("Missing code in request");
    }
    
    // Parse the HQL code and evaluate each form in the persistent environment.
    const forms = parseHQL(code);
    let result: any = null;
    for (const form of forms) {
      result = await evaluateAsync(form, persistentEnv);
    }
    
    // Format the result into a string.
    const resultStr = formatValue(result);
    
    return new Response(JSON.stringify({ result: resultStr }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}, { port: PORT });
