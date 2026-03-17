import { getClaudeCodeToken } from "./src/hlvm/providers/claude-code/auth.ts";
import { http } from "./src/common/http-client.ts";

const token = await getClaudeCodeToken();
const endpoint = "https://api.anthropic.com";
const url = `${endpoint}/v1/models?limit=100`;

console.log("Calling:", url);

const response = await http.fetchRaw(url, {
  headers: {
    "Authorization": `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
  },
  timeout: 30000,
});

console.log("Status:", response.status);
console.log("OK:", response.ok);

const body = await response.text();
console.log("Body:", body);
