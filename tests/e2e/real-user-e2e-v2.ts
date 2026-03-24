/**
 * REAL E2E Test V2 — Complex schemas + agent verification
 *
 * Run: deno run --allow-all tests/e2e/real-user-e2e-v2.ts
 */

import { registerApis } from "../../src/hlvm/api/index.ts";
await registerApis();

const ai = (globalThis as any).ai;
const agent = (globalThis as any).agent;

const MODEL = "claude-code/claude-haiku-4-5-20251001";

let passed = 0;
let failed = 0;
const results: string[] = [];

function ok(name: string, detail?: string) {
  passed++;
  results.push(`  \u2713 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
}
function fail(name: string, err: string) {
  failed++;
  results.push(`  \u2717 ${name} \u2014 ${err}`);
}

// ════════════════════════════════════════════════════════════
// PART A: Complex / nested schema scenarios
// ════════════════════════════════════════════════════════════

// A1: Deeply nested object
try {
  const r = await ai("Describe Tokyo as a travel destination", {
    model: MODEL,
    schema: {
      city: "string",
      country: "string",
      population: "number",
      coordinates: { lat: "number", lng: "number" },
      bestSeasons: ["string"],
      topAttractions: [{ name: "string", category: "string", rating: "number 1-5" }],
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    typeof r.city === "string" &&
    typeof r.country === "string" &&
    typeof r.population === "number" &&
    typeof r.coordinates === "object" && typeof r.coordinates.lat === "number" &&
    Array.isArray(r.bestSeasons) &&
    Array.isArray(r.topAttractions) && r.topAttractions.length > 0 &&
    typeof r.topAttractions[0].name === "string";
  if (valid) ok("A1: deeply nested object", `${r.topAttractions.length} attractions, pop ${r.population}`);
  else fail("A1: deeply nested object", `structure mismatch: ${JSON.stringify(r).slice(0, 150)}`);
} catch (e: any) { fail("A1: deeply nested object", e.message); }

// A2: Array of complex objects
try {
  const r = await ai("List 3 famous scientists and their key contributions", {
    model: MODEL,
    schema: {
      scientists: [{
        name: "string",
        nationality: "string",
        field: "string",
        born: "number",
        contributions: ["string"],
        isAlive: "boolean",
      }],
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    Array.isArray(r.scientists) && r.scientists.length === 3 &&
    r.scientists.every((s: any) =>
      typeof s.name === "string" &&
      typeof s.field === "string" &&
      typeof s.born === "number" &&
      Array.isArray(s.contributions) && s.contributions.length > 0 &&
      typeof s.isAlive === "boolean"
    );
  if (valid) ok("A2: array of complex objects", `[${r.scientists.map((s: any) => s.name).join(", ")}]`);
  else fail("A2: array of complex objects", `structure: ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) { fail("A2: array of complex objects", e.message); }

// A3: Schema + data — classify multiple items with nested output
try {
  const r = await ai("Analyze each food item for nutrition", {
    model: MODEL,
    data: {
      items: [
        { name: "Apple", servingSize: "1 medium" },
        { name: "Pizza slice", servingSize: "1 slice" },
        { name: "Broccoli", servingSize: "1 cup" },
      ],
    },
    schema: {
      analysis: [{
        name: "string",
        calories: "number",
        healthRating: "number 1-10",
        macros: { protein: "number grams", carbs: "number grams", fat: "number grams" },
        tags: ["string"],
      }],
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    Array.isArray(r.analysis) && r.analysis.length === 3 &&
    r.analysis.every((a: any) =>
      typeof a.name === "string" &&
      typeof a.calories === "number" &&
      typeof a.healthRating === "number" &&
      typeof a.macros === "object" &&
      typeof a.macros.protein === "number" &&
      Array.isArray(a.tags)
    );
  if (valid) ok("A3: data + nested schema", `${r.analysis.map((a: any) => `${a.name}(${a.calories}cal)`).join(", ")}`);
  else fail("A3: data + nested schema", `structure: ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) { fail("A3: data + nested schema", e.message); }

// A4: Boolean + enum + number constraints
try {
  const r = await ai("Evaluate Python as a programming language", {
    model: MODEL,
    schema: {
      language: "string",
      isCompiled: "boolean",
      isOpenSource: "boolean",
      typingSystem: "static|dynamic|gradual",
      yearCreated: "number",
      popularityRank: "number 1-20",
      paradigms: ["string"],
      pros: ["string"],
      cons: ["string"],
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    r.language === "Python" &&
    typeof r.isCompiled === "boolean" &&
    typeof r.isOpenSource === "boolean" &&
    typeof r.yearCreated === "number" && r.yearCreated > 1900 &&
    Array.isArray(r.paradigms) && r.paradigms.length > 0 &&
    Array.isArray(r.pros) && r.pros.length > 0;
  if (valid) ok("A4: booleans + enums + constraints", `compiled=${r.isCompiled}, typing=${r.typingSystem}, year=${r.yearCreated}`);
  else fail("A4: booleans + enums + constraints", `structure: ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) { fail("A4: booleans + enums + constraints", e.message); }

// A5: Recursive-like nesting (org chart)
try {
  const r = await ai("Create a small company org chart with CEO and 2 departments, each with a manager and 2 employees", {
    model: MODEL,
    schema: {
      company: "string",
      ceo: {
        name: "string",
        title: "string",
        departments: [{
          name: "string",
          manager: { name: "string", title: "string" },
          employees: [{ name: "string", role: "string" }],
        }],
      },
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    typeof r.company === "string" &&
    typeof r.ceo === "object" &&
    typeof r.ceo.name === "string" &&
    Array.isArray(r.ceo.departments) && r.ceo.departments.length === 2 &&
    r.ceo.departments.every((d: any) =>
      typeof d.name === "string" &&
      typeof d.manager === "object" && typeof d.manager.name === "string" &&
      Array.isArray(d.employees) && d.employees.length >= 2
    );
  if (valid) ok("A5: recursive org chart", `${r.company}: ${r.ceo.departments.map((d: any) => d.name).join(", ")}`);
  else fail("A5: recursive org chart", `structure: ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) { fail("A5: recursive org chart", e.message); }

// A6: Schema with many fields — stress test
try {
  const r = await ai("Describe a fictional character for a fantasy RPG game", {
    model: MODEL,
    schema: {
      name: "string",
      race: "human|elf|dwarf|orc",
      class: "warrior|mage|rogue|healer",
      level: "number 1-100",
      hitPoints: "number",
      stats: { strength: "number 1-20", intelligence: "number 1-20", dexterity: "number 1-20", wisdom: "number 1-20", charisma: "number 1-20" },
      inventory: [{ item: "string", quantity: "number", isEquipped: "boolean" }],
      backstory: "string",
    },
  });
  const valid =
    typeof r === "object" && r !== null &&
    typeof r.name === "string" &&
    ["human", "elf", "dwarf", "orc"].includes(r.race) &&
    ["warrior", "mage", "rogue", "healer"].includes(r.class) &&
    typeof r.level === "number" &&
    typeof r.stats === "object" && typeof r.stats.strength === "number" &&
    Array.isArray(r.inventory) && r.inventory.length > 0 &&
    typeof r.backstory === "string" && r.backstory.length > 10;
  if (valid) ok("A6: RPG character (many fields)", `${r.name} L${r.level} ${r.race} ${r.class}, STR ${r.stats.strength}`);
  else fail("A6: RPG character (many fields)", `structure: ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) { fail("A6: RPG character (many fields)", e.message); }

// A7: asyncMap + schema — batch structured extraction
try {
  const sentences = [
    "The Eiffel Tower in Paris was built in 1889",
    "Mount Fuji in Japan is 3776 meters tall",
    "The Great Wall of China spans over 20000 km",
  ];
  const extracted = await (await import("../../src/hql/lib/stdlib/js/core.js")).asyncMap(
    async (sentence: string) => {
      return await ai("Extract the key facts from this sentence", {
        model: MODEL,
        data: { sentence },
        schema: { subject: "string", location: "string", keyFact: "string", numericValue: "number" },
      });
    },
    sentences,
  );
  const valid =
    Array.isArray(extracted) && extracted.length === 3 &&
    extracted.every((e: any) =>
      typeof e === "object" && e !== null &&
      typeof e.subject === "string" &&
      typeof e.location === "string" &&
      typeof e.numericValue === "number"
    );
  if (valid) ok("A7: asyncMap + schema batch", `${extracted.map((e: any) => `${e.subject}(${e.numericValue})`).join(", ")}`);
  else fail("A7: asyncMap + schema batch", `structure: ${JSON.stringify(extracted).slice(0, 200)}`);
} catch (e: any) { fail("A7: asyncMap + schema batch", e.message); }

// ════════════════════════════════════════════════════════════
// PART B: Agent — 2 quick loops
// ════════════════════════════════════════════════════════════

const agentTasks = [
  { prompt: "What is the capital of South Korea? Reply in one sentence.", check: (r: string) => r.toLowerCase().includes("seoul") },
  { prompt: "What is 15 * 17? Reply with only the number.", check: (r: string) => r.includes("255") },
];

for (let i = 0; i < agentTasks.length; i++) {
  const { prompt, check } = agentTasks[i];
  try {
    const r = await agent(prompt, { model: MODEL });
    if (typeof r === "string" && r.length > 0 && check(r))
      ok(`B${i + 1}: agent("${prompt.slice(0, 40)}...")`, `"${r.trim().slice(0, 60)}"`);
    else
      fail(`B${i + 1}: agent`, `unexpected: "${r?.slice(0, 80)}"`);
  } catch (e: any) {
    fail(`B${i + 1}: agent`, e.message);
  }
}

// ===== REPORT =====
console.log("\n" + "\u2550".repeat(65));
console.log(`  REAL E2E V2 \u2014 Complex Schemas + Agent (${MODEL})`);
console.log("\u2550".repeat(65));
for (const line of results) console.log(line);
console.log("\u2550".repeat(65));
console.log(`  ${passed} passed | ${failed} failed`);
console.log("\u2550".repeat(65) + "\n");

if (failed > 0) Deno.exit(1);
