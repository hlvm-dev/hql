import { getClaudeCodeToken } from "./src/hlvm/providers/claude-code/auth.ts";
import { http } from "./src/common/http-client.ts";

const token = await getClaudeCodeToken();
const endpoint = "https://api.anthropic.com";
const url = `${endpoint}/v1/messages`;

console.log("Calling:", url);

const response = await http.fetchRaw(url, {
  method: "POST",
  headers: {
    "x-api-key": token,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: "What is 2+2? One word only."
      }
    ]
  }),
  timeout: 30000,
});

console.log("Status:", response.status);
const body = await response.text();
console.log("Body:", body.substring(0, 500));
