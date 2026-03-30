# 05 — Competitive Analysis

**What exists, what doesn't, and where HLVM fits.**

---

## The Landscape (2026)

### Category 1: Chat Interfaces

Products where AI is accessed through conversation.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ChatGPT / Claude / Gemini                                   │
│                                                              │
│  What they do well:                                          │
│  ├── Natural language interaction                            │
│  ├── Broad knowledge                                         │
│  ├── Custom GPTs / Projects / Gems                           │
│  └── Growing tool access (code interpreter, browsing)        │
│                                                              │
│  What they cannot do:                                        │
│  ├── Access your local filesystem                            │
│  ├── Run commands on your computer                           │
│  ├── Orchestrate multi-agent teams                           │
│  ├── Be automated (each use is manual)                       │
│  ├── Compose into pipelines                                  │
│  └── Work offline / with local models                        │
│                                                              │
│  Verdict: Great for one-off questions.                       │
│           Cannot automate anything.                          │
│           Cannot access your local system.                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 2: Code-First Agent Frameworks

Products for developers who write agent orchestration in Python/JS.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  LangChain / CrewAI / AutoGen / Mastra                       │
│                                                              │
│  What they do well:                                          │
│  ├── Full programmatic control                               │
│  ├── Multi-agent orchestration                               │
│  ├── Tool/function calling                                   │
│  ├── Memory systems                                          │
│  └── Multi-provider support                                  │
│                                                              │
│  What they cannot do:                                        │
│  ├── Non-developers cannot use them at all                   │
│  ├── No GUI — terminal only                                  │
│  ├── No one-click execution                                  │
│  ├── No module marketplace / sharing                         │
│  ├── No native macOS integration                             │
│  ├── Heavy Python dependency management                      │
│  └── Each project is a fresh setup                           │
│                                                              │
│  Verdict: Powerful for developers.                           │
│           Inaccessible to everyone else.                     │
│           No ecosystem / sharing story.                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 3: macOS Automation

Products that automate workflows on Mac with visual interfaces.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Apple Shortcuts / Automator / Raycast                        │
│                                                              │
│  What they do well:                                          │
│  ├── Native macOS integration                                │
│  ├── Visual workflow builder (Shortcuts)                     │
│  ├── Spotlight-style launcher (Raycast)                      │
│  ├── One-click execution                                     │
│  └── Some AI features (Raycast AI)                           │
│                                                              │
│  What they cannot do:                                        │
│  ├── No multi-agent orchestration                            │
│  ├── No real programming language                            │
│  ├── Limited AI integration (basic prompts only)             │
│  ├── Cannot compose complex AI pipelines                     │
│  ├── Cannot run autonomous agent loops                       │
│  ├── No schema-enforced AI output                            │
│  └── Shortcuts blocks are clunky for complex logic           │
│                                                              │
│  Verdict: Great for simple automation.                       │
│           Cannot handle complex AI workflows.                │
│           Limited composability.                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 4: AI Agent Products

Products that package AI agents with specific capabilities.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  PaperClip / Devin / Cursor / Claude Code                    │
│                                                              │
│  What they do well:                                          │
│  ├── Domain-specific AI agents (coding, research)            │
│  ├── Deep integration with their domain                      │
│  ├── Multi-step autonomous execution                         │
│  └── Some team/collaboration features                        │
│                                                              │
│  What they cannot do:                                        │
│  ├── Limited to their domain (coding only, etc.)             │
│  ├── Cannot create new capability types                      │
│  ├── No user-authored modules                                │
│  ├── No module marketplace                                   │
│  ├── Not a general platform                                  │
│  └── Cannot compose into other workflows                     │
│                                                              │
│  Verdict: Good at one thing.                                 │
│           Not a platform.                                    │
│           Cannot be extended by users.                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## The Gap

```
                    Full AI Power
                    (agents, teams,
                     multi-step,
                     local access)
                         ▲
                         │
  LangChain ●            │
  CrewAI    ●            │
  AutoGen   ●            │
                         │
                         │         ● HLVM
                         │           (HERE)
                         │
                         │
  Devin     ●            │
  PaperClip ●            │
                         │
                         │
  Raycast AI ●           │
                         │
  ChatGPT    ●           │         ● Apple Shortcuts
  Claude     ●           │
                         │
                         └──────────────────────────► Ease of Use
                    Developer-only              One-click for anyone
```

**The gap: nobody combines full AI power WITH one-click ease of use.**

- Upper-left (LangChain etc.): Full power, developer-only
- Lower-left (ChatGPT etc.): Easy but limited, no automation
- Lower-right (Shortcuts): Easy and automated, but weak AI
- **Upper-right (HLVM): Full power AND one-click. The empty quadrant.**

---

## Feature Comparison Matrix

```
┌───────────────────┬────────┬────────┬────────┬────────┬──────┐
│                   │ChatGPT │LangChn │Raycast │Shortct │ HLVM │
├───────────────────┼────────┼────────┼────────┼────────┼──────┤
│ AI calls          │  ✓     │  ✓     │  ✓     │  ~     │  ✓   │
│ Agent loops       │  ~     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Multi-agent teams │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Local file access │  ✗     │  ✓     │  ~     │  ✓     │  ✓   │
│ Shell execution   │  ✗     │  ✓     │  ✗     │  ~     │  ✓   │
│ Real language     │  ✗     │  ✓(Py) │  ✗     │  ✗     │  ✓   │
│ Schema-typed AI   │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Native macOS GUI  │  ✗     │  ✗     │  ✓     │  ✓     │  ✓   │
│ One-click execute │  ✗     │  ✗     │  ✓     │  ✓     │  ✓   │
│ Module store      │  ~(GPT)│  ✗     │  ✓     │  ✓     │  ✓   │
│ Composable        │  ✗     │  ✓     │  ✗     │  ~     │  ✓   │
│ Multi-provider    │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Local/offline     │  ✗     │  ✓     │  ✗     │  ✓     │  ✓   │
│ Memory/context    │  ~     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Effect/safety     │  ✗     │  ✗     │  ✗     │  ✗     │  ✓   │
│ ESM portable      │  ✗     │  ✗     │  ✗     │  ✗     │  ✓   │
├───────────────────┼────────┼────────┼────────┼────────┼──────┤
│ TOTAL             │  3/16  │  10/16 │  4/16  │  5/16  │ 16/16│
└───────────────────┴────────┴────────┴────────┴────────┴──────┘

✓ = full support   ~ = partial/limited   ✗ = not supported
```

No other product scores above 10/16. HLVM scores 16/16.

The revolution is not any single column. It is the ONLY row that is all green.

---

## HLVM's Unique Advantages

### 1. The Only Full Stack

HLVM is the only product that spans the entire chain:

```
Authoring Language (HQL)
       ↓
Compilation (ESM)
       ↓
Distribution (Module Store)
       ↓
Discovery (Store GUI + Spotlight)
       ↓
Installation (one click)
       ↓
Execution (Hotbar icon → agent engine)
       ↓
AI Runtime (multi-provider, multi-agent)
```

Every competitor owns only a slice of this chain.

### 2. Platform-Agnostic Output

ESM JavaScript runs everywhere. Modules created on HLVM can be:

```
Used in:
  ├── HLVM Hotbar (primary)
  ├── Any Node.js project (import from npm)
  ├── Any Deno project (import from JSR or HTTP)
  ├── Browsers (ESM native)
  ├── Bun
  └── Any future JS runtime

Not locked to HLVM. Standard format.
```

### 3. The Effect System as Safety Model

No other product has compile-time safety classification for AI modules:

```
Effect         →  Permission  →  GUI Badge  →  Runtime Sandbox
"pure"         →  none        →  ● Green    →  no access
"ai"           →  network     →  ● Yellow   →  network only
"agent"        →  full        →  ● Red      →  full access
```

Users can make informed decisions before installing. Modules are sandboxed
at runtime based on their declared effect level.

### 4. AI Can Author Modules

The platform consumes its own output:

```
User says "I need X"
  → AI builds an HQL module that does X
  → Module appears on Hotbar
  → User clicks to use it
  → Optionally deploys to Store for others
```

No other product has this self-reinforcing loop where AI creates shareable,
reusable, one-click capabilities.

### 5. The Network Effect Moat

Once the Module Store has critical mass:

```
More modules → More users → More authors → More modules → ...
```

This flywheel is nearly impossible to replicate. You cannot copy a network
effect. You can only build your own.

---

## Risks and Mitigations

### Risk: "Nobody will write HQL"

**Mitigation**: Modules can also be written in plain JavaScript. HQL is the
recommended authoring language but not required. The Store accepts any valid
ESM with an hlvm.json manifest. Additionally, AI can write modules —
users don't need to learn any language at all.

### Risk: "Not enough modules at launch"

**Mitigation**: Launch with 20-30 high-quality official @hlvm/* modules
covering common use cases (sentiment analysis, summarization, code review,
web research, report generation, etc.). These establish quality expectations
and give users immediate value.

### Risk: "Security of community modules"

**Mitigation**: Effect-based permission system, verified badge for reviewed
modules, runtime sandboxing, user reporting, automated malware scanning on
publish. Users can choose to only install Official/Verified modules.

### Risk: "macOS only"

**Mitigation**: The core is the hlvm binary (CLI), which runs on any platform.
The macOS GUI is a thin shell. The CLI provides identical functionality.
A web GUI or Linux GUI could be added later. Modules themselves are ESM —
they run everywhere.

### Risk: "Competing with Raycast / Apple"

**Mitigation**: Raycast is a launcher with AI chat. Apple Shortcuts is visual
blocks. Neither has a module store for AI capabilities, agent orchestration,
multi-step pipelines, or a real programming language. HLVM operates in a
different category — it is a platform, not a launcher.
