# HLVM Platform Thesis

Prepared: 2026-03-20 | Last updated: 2026-03-31

This is the single canonical document for understanding HLVM as a high-level AI
runtime platform.

It is intentionally about:

- what HLVM is trying to become
- why that direction matters
- what the software should feel like from the user's point of view
- where the current architecture already supports that direction
- where the current architecture is still too shallow
- what must remain true as the system evolves

It is intentionally **not** an implementation or migration document.

---

## 1. Executive Thesis

HLVM should not stop at being a multi-provider model adapter.

HLVM should become the runtime that executes user intent across the AI
ecosystem the user actually has access to.

### 1.1 The "LLVM for LLM" Analogy

The clearest way to understand what HLVM is trying to become:

```text
LLVM is the central platform that any language, any optimization pass,
and any hardware target plugs into.

HLVM is the central platform that any input frontend, any AI model,
any tool backend, and any policy plugs into.
```

This is a role analogy, not a technique analogy. HLVM does not need to
replicate LLVM's specific techniques (SSA, optimization passes, target
codegen). HLVM needs to play the same structural role in the LLM ecosystem
that LLVM plays in the compiler ecosystem:

```text
LLVM:   any language  →  IR  →  any target
HLVM:   any input     →  orchestrator  →  any backend
```

Concretely:

```text
┌─────────────────────────────────────────────────────────┐
│                    HLVM Platform                        │
│                                                         │
│  Inputs              Core               Backends        │
│  ──────              ────               ────────        │
│  CLI prompt    ─┐                  ┌─  Ollama local     │
│  GUI chat      ─┤                  ├─  Anthropic API    │
│  API endpoint  ─┤  → Orchestrator  ├─  OpenAI API       │
│  Webhooks      ─┤    + Policy      ├─  Google API       │
│  Agent teams   ─┘    + Routing     ├─  MCP servers      │
│                                    ├─  Local tools      │
│                                    └─  Hosted tools     │
└─────────────────────────────────────────────────────────┘
```

The key insight is that HLVM already owns the orchestrator — the central
execution loop that corresponds to LLVM's optimizer pipeline. Everything
else plugs in.

### 1.2 Core Idea

```text
User expresses intent
  -> HLVM decides how the task should be executed
     -> local tools when the task needs the user's machine
     -> hosted vendor capabilities when they are better
     -> MCP tools when external systems are involved
     -> local models or cloud models as appropriate
     -> fallback if one path is unavailable
```

The user should mostly not have to think about:

- provider names
- model names
- vendor-specific hosted tool names
- whether a capability came from a local tool, MCP, or vendor infrastructure

The user should think in terms of:

- the task
- optional constraints
- optional preferences

Examples:

- "Fix this bug in my repo using the latest docs."
- "Research this topic, but keep my files local."
- "Be cheap unless quality really matters."
- "Use local only."

That is the long-term goal.

---

## 2. The Real Question

The core question is not:

```text
"Can HLVM talk to many LLM providers?"
```

That question matters, but it is too small.

The real question is:

```text
"Can HLVM become the runtime that completes tasks correctly across
the AI ecosystem available to the user?"
```

That is a larger and more meaningful problem.

It asks HLVM to solve:

- not only which model to call
- but also which execution path to use
- and not only how to call a tool
- but also which tool family should fulfill the task
- and not only how to normalize provider responses
- but also how to preserve coherent behavior when capabilities differ

This is the conceptual jump from adapter to runtime.

---

## 3. The Core Distinction

```text
Crowded lower abstraction:
  "Send one prompt to many providers."

Desired higher abstraction:
  "Complete one task correctly across local tools, cloud tools,
   local models, cloud models, MCP, policies, and fallback paths."
```

That distinction is the center of this entire thesis.

An adapter is mainly a translator.

A runtime platform is a manager, scheduler, policy interpreter, and execution
system.

More compactly:

```text
adapter = interface translation
runtime = task execution control
```

---

## 4. Basic Vocabulary

This section exists because many architecture debates become confused when
different layers are mixed together.

### 4.1 Model

The model is the brain.

Examples:

- Claude Opus
- GPT
- Gemini
- Llama

### 4.2 Provider

The provider is the entity that exposes the model through an API or runtime.

Examples:

- OpenAI
- Anthropic
- Google
- Ollama
- Claude Code provider path in this repository

### 4.3 Local model

A model running on the user's machine.

Example:

- Ollama-hosted local model

### 4.4 Cloud model

A model accessed via vendor infrastructure.

Examples:

- Anthropic-hosted model
- OpenAI-hosted model
- Google-hosted model

### 4.5 Hosted vendor capability

A capability executed on vendor infrastructure rather than on the user's
machine.

Examples:

- hosted web search
- hosted URL fetch
- hosted code execution
- hosted file retrieval over uploaded documents

### 4.6 Local HLVM tool

A tool executed by HLVM on the user's machine or in the user's workspace.

Examples:

- `read_file`
- `write_file`
- `edit_file`
- `search_code`
- `shell_exec`
- `git_status`

### 4.7 MCP tool

A tool exposed through MCP.

Important distinction:

```text
MCP tells HLVM how to connect to a tool.
MCP does not decide whether the task should use that tool.
```

That decision belongs to the higher runtime layer.

### 4.8 Runtime

The runtime is the system that decides:

- what needs to happen
- in what order
- on which backend
- under which policy
- with which fallback

HLVM should be understood primarily in this sense.

### 4.9 Semantic capability

A semantic capability is the task-level meaning of a need.

Example:

```text
Task need:
  public web search

Possible backend realizations:
  - Anthropic hosted search
  - OpenAI hosted search
  - Google hosted search
  - MCP search tool
  - HLVM local search fallback
```

The semantic capability is not the same thing as a vendor tool name.

---

## 5. What HLVM Should Mean At The Highest Level

The cleanest single-sentence definition is:

```text
HLVM should be the runtime that executes user intent across the
AI backends and tool backends the user actually has access to.
```

There are four important parts in that sentence.

### 5.1 Runtime

HLVM is not merely a library or adapter. It is the system that decides how the
task unfolds.

### 5.2 Executes

The job is not merely to choose a model. The job is to complete the task
correctly.

### 5.3 User intent

The unit of abstraction is the user's task, not the provider's wire format.

### 5.4 Actually has access to

HLVM cannot abstract away:

- keys
- subscriptions
- entitlements
- billing

HLVM does not create access. HLVM manages execution over accessible backends.

---

## 6. Reachable Backends Only

This point must be explicit because it causes repeated confusion.

HLVM cannot promise:

```text
"Use every vendor and every capability automatically without setup."
```

That is not realistic.

The realistic promise is:

```text
"Given the backends the user has enabled, HLVM will orchestrate them
coherently."
```

Examples of enabled backends may include:

- Ollama running locally
- Anthropic API key
- OpenAI API key
- Google API key
- Claude Code OAuth
- configured MCP servers

Once those are available, HLVM should hide as much execution complexity as it
reasonably can.

The runtime must reason over:

```text
possible backends for this user, this machine, this session
```

not over an imaginary universal capability catalog detached from reality.

---

## 7. Why This Is Not The Same As MCP

HLVM's higher-level role is not the same as MCP.

MCP standardizes how tools and context are connected.

HLVM's higher-level role is to decide:

- whether a task should use an MCP tool at all
- whether a local tool is better
- whether a hosted vendor capability is better
- whether policy disallows one of those options
- which fallback should apply if the preferred option is unavailable

Simple distinction:

```text
MCP:
  How do I connect to tools and resources?

HLVM:
  Which execution path should fulfill this task?
```

MCP is therefore a lower-layer input into HLVM's runtime decisions, not a
replacement for them.

---

## 8. Final Destination And Transitional Product Posture

This thesis distinguishes between:

- the end-state product shape
- the transitional product shape while the higher abstraction is still maturing

Those two do not need to be identical.

The long-term destination is:

```text
high-level task execution abstraction
```

The user should mostly speak in task language and let HLVM absorb the execution
details.

But the transitional product posture may still be:

```text
manual model/provider choice remains primary
higher-level runtime abstraction is opt-in
until the automatic path is stable enough to trust
```

This does not contradict the thesis.

It is a staged product posture on the way to the thesis.

So two things are true at once:

```text
Final product:
  may be automatic by default

Transitional product:
  does not have to be
```

Until the higher-level runtime behavior is stable, it is acceptable for HLVM to
remain primarily model/provider-explicit while offering the higher abstraction
as an opt-in path.

---

## 9. Manual Control Must Remain First-Class

The final platform must still allow the user to:

- choose a specific model
- choose a specific provider
- force local only
- forbid uploads
- otherwise constrain execution directly

Manual control is not a contradiction to the platform vision.

It is a necessary trust boundary.

The right long-term relationship is:

```text
End-state default:
  HLVM decides

Override:
  user constrains HLVM's decision space
```

So the higher abstraction does not replace manual control.

It makes manual control optional rather than mandatory.

---

## 10. What The User Should And Should Not Need To Think About

The user should think about:

- the task
- optional constraints
- optional preferences

Examples:

- "Fix this bug."
- "Use latest official docs."
- "Keep my code local."
- "Be cheap."
- "Use Claude only."

The user should not usually need to think about:

- which hosted web-search variant exists on which provider
- how to name the search capability for a given vendor
- how to combine local tools and cloud reasoning
- whether a fallback path is necessary
- whether a given task should use local shell or hosted code execution

These should be runtime concerns, not routine user concerns.

---

## 11. What The Software Should Feel Like

The target product contract is:

```text
The user states the task and optional constraints.
HLVM handles the execution details across available backends.
```

### 11.1 Setup phase

Setup is where HLVM learns what is available.

Examples:

- Ollama detected
- Anthropic key detected
- OpenAI key missing
- Claude Code login present
- MCP server configured

The product should help by:

- discovering available backends
- reading environment/config when allowed
- presenting backend status
- allowing the user to enable or disable paths
- allowing the user to define preferences

### 11.2 Runtime phase

Once setup is complete, the normal experience should be:

```text
user intent in
  -> HLVM execution judgment
  -> coherent result out
```

The point of the platform is that the runtime phase should feel simple even if
the setup phase acknowledges complexity.

### 11.3 Wrong feeling

```text
"Pick a provider.
 Pick a model.
 Pick a search strategy.
 Pick a tool set.
 Now I will send your prompt."
```

### 11.4 Right feeling

```text
"State the task.
 Optionally give me constraints.
 I will execute it with the best available path."
```

That is the experiential difference between a router and a runtime platform.

---

## 12. Canonical Behavior Examples

### 12.1 Public research

User says:

```text
"Research the latest official guidance on topic X."
```

Expected behavior:

```text
1. Classify the task as public-information heavy.
2. Prefer hosted vendor search if available.
3. If not available, use MCP search or HLVM local fallback.
4. Synthesize the answer with the chosen model path.
5. Return the answer with sources.
```

Expected user experience:

- no vendor/tool naming burden
- no manual routing burden
- visible sources

### 12.2 Private repo debugging

User says:

```text
"Find the bug in my local repo and suggest a fix."
```

Expected behavior:

```text
1. Recognize that the task needs the local filesystem.
2. Use local file/code/git/shell tools.
3. Avoid data upload if policy forbids it.
4. Use local or cloud reasoning depending on policy and availability.
5. Return the diagnosis and proposed fix.
```

Expected user experience:

- no need to explain that local code is sensitive
- no need to choose between `read_file` and `search_code`
- no need to choose between local and cloud reasoning unless desired

### 12.3 Mixed local-plus-public task

User says:

```text
"Read my local code, check the latest official docs, then patch the code."
```

Expected behavior:

```text
1. Split the task conceptually:
   - local inspection
   - public research
   - synthesis
   - local write

2. Route each part correctly:
   - local tools for local inspection
   - hosted search or fallback for public research
   - best allowed reasoning path for synthesis
   - local write/edit tools for the patch

3. Preserve coherence across the whole task.
```

Expected user experience:

- one task
- one session
- one coherent result

not:

- several manually staged sub-workflows

### 12.4 Cost-constrained analysis

User says:

```text
"Analyze this data, but stay cheap if possible."
```

Expected behavior:

```text
1. Treat cost as a real policy input.
2. Prefer cheaper/local paths first.
3. Escalate only when needed.
4. Preserve quality where the task requires it.
```

### 12.5 Local-only task

User says:

```text
"Keep everything local."
```

Expected behavior:

```text
1. Disable hosted execution paths for this task.
2. Use local models and local tools only.
3. Refuse or explain when the task cannot be completed locally.
4. Never silently violate the locality constraint.
```

### 12.6 Provider-pinned task

User says:

```text
"Use Claude Opus only for this task."
```

Expected behavior:

```text
1. Constrain execution to the requested provider/model.
2. Continue making lower-level decisions where allowed.
3. Report plainly if the constraint makes the task impossible.
```

This example matters because it proves that manual model choice remains a real
first-class feature even in the high-level platform vision.

---

## 13. When HLVM Should Decide And When It Should Ask

The runtime should avoid turning every task into a questionnaire.

HLVM should decide automatically when:

- a safe default exists
- the policy already resolves the decision
- the task clearly implies the right execution path
- fallback can happen silently without violating trust

HLVM should ask the user when:

- a hard policy boundary would otherwise be crossed
- an irreversible or risky action is required
- multiple valid paths have materially different consequences and no policy resolves them
- the requested task becomes impossible under current constraints

Example:

Good automatic behavior:

```text
"Research latest docs" -> choose hosted or fallback search automatically
```

Necessary clarification:

```text
"Fix this and commit it" -> ask if commit requires user approval or policy says so
```

---

## 14. How Failure And Fallback Should Feel

One of the most important runtime qualities is graceful degradation.

Wrong behavior:

```text
preferred provider unavailable
  -> task collapses
  -> user is forced to understand internal architecture
```

Better behavior:

```text
preferred path unavailable
  -> fallback path selected if policy allows
  -> task continues
  -> user sees one coherent result
```

Best behavior:

```text
preferred path unavailable
  -> fallback path selected
  -> result remains useful
  -> provenance makes the path understandable if asked
```

This is a defining property of a runtime platform.

---

## 15. The Staircase To The Final Goal

This thesis is intentionally not an implementation document, but it still needs
to be explicit about one important reality:

```text
The final platform vision is too large to arrive all at once.
It must be reached through prerequisite layers.
```

That does not weaken the vision. It clarifies how to think about progress.

The right mental model is:

```text
highest abstraction = destination
lower-level truths = prerequisites
```

Or visually:

```text
                    FINAL GOAL
     ┌──────────────────────────────────────────────┐
     │ HLVM as task-level AI runtime platform       │
     │ "User states intent, HLVM handles the rest"  │
     └──────────────────────────────────────────────┘
                          ▲
                          │
                          │  11. trusted default
                          │  10. judgment quality
                          │   9. opt-in higher abstraction
                          │   8. mixed-task coherence
                          │   7. more capability families
                          │   6. provenance and trust
                          │   5. first capability pilot
                          │   4. execution surface
                          │   3. policy awareness
                          │   2. availability awareness
                          │   1. stable manual baseline
                          │   0. guardrails
                          │
CURRENT ──────────────────┘
```

The key idea is simple:

```text
High abstraction is not one feature.
High abstraction is the result of many lower-level capabilities
working together coherently.
```

### 15.1 Phase 0: Guardrails

Purpose:

- define what must remain true while the system evolves
- prevent the platform vision from becoming uncontrolled abstraction drift

Core truths:

- manual model/provider choice remains valid
- the system must not pretend inaccessible backends exist
- higher abstraction may remain opt-in while trust is still being earned
- user constraints remain real and binding

What this phase means conceptually:

```text
The destination may be higher abstraction.
The transition must still preserve trust and user control.
```

### 15.2 Phase 1: Stable Manual Baseline

Purpose:

- preserve HLVM's current value as a reliable manually steered runtime

User-facing meaning:

- the user can still choose a provider
- the user can still choose a model
- the user can still force local-only or similar constraints

Why this matters:

```text
If the manual baseline is not strong,
the higher abstraction has nothing trustworthy to stand on.
```

Visual:

```text
User
  -> choose model/provider
  -> HLVM orchestrates
  -> HLVM tools execute
  -> result
```

### 15.3 Phase 2: Availability Awareness

Purpose:

- HLVM must know what is actually available for this user, machine, and
  session

This includes realities such as:

- Ollama present or absent
- provider keys present or absent
- Claude Code available or unavailable
- MCP services configured or missing

Why this matters:

```text
HLVM cannot become a high-level runtime
if it reasons over imaginary backends.
```

The runtime must think in terms of:

```text
reachable backends
```

not:

```text
all theoretically possible backends in the ecosystem
```

### 15.4 Phase 3: Policy Awareness

Purpose:

- HLVM must understand not just what exists, but what is allowed

Examples of real constraints:

- keep data local
- no uploads
- cloud allowed
- cost sensitive
- quality preferred

Why this matters:

```text
A capability that exists but is disallowed
is not part of the real execution space for that task.
```

Visual:

```text
reachable backends
  minus disallowed paths
  equals
allowed execution surface
```

### 15.5 Phase 4: Execution Surface

Purpose:

- HLVM begins reasoning over one coherent current execution surface rather than
  over scattered disconnected tools and vendors

This means the system increasingly sees the task through the lens of:

- what is reachable now
- what is allowed now
- what execution families are actually on the table

Why this matters:

```text
The platform does not become higher abstraction
by listing more tools.
It becomes higher abstraction by operating over one coherent
execution reality for the current task.
```

### 15.6 Phase 5: First Capability Pilot

Purpose:

- prove the platform idea with one concrete capability family

The most natural example is public web search because it already reveals the
difference between:

- vendor-hosted capabilities
- external tool paths
- HLVM-local fallback behavior

Why this matters:

```text
The thesis becomes real when one user intent
can be fulfilled through different backend paths
without changing the user's conceptual experience.
```

This is where a question like:

```text
"Research the latest official guidance on X."
```

begins to mean:

```text
one task need
  -> multiple possible backend realizations
```

instead of:

```text
one fixed concrete tool every time
```

### 15.7 Phase 6: Provenance And Trust

Purpose:

- ensure that abstraction does not feel like unsafe black-box magic

The user should increasingly be able to understand:

- what stayed local
- what used cloud infrastructure
- what path fulfilled the task
- what fallback occurred if any

Why this matters:

```text
Higher abstraction without provenance feels like loss of control.
Higher abstraction with provenance feels like trustworthy delegation.
```

### 15.8 Phase 7: More Capability Families

Purpose:

- extend the same platform behavior beyond one pilot capability

The point is not a particular list of implementations.
The point is that the same higher-level product logic begins to hold across
multiple task families.

Why this matters:

```text
One successful capability proves the idea is possible.
Several successful capability families prove it is a platform.
```

### 15.9 Phase 8: Mixed-Task Coherence

Purpose:

- HLVM must be able to treat one user request as one coherent job even when it
  requires multiple execution families

Examples:

- local repo inspection
- public documentation research
- cloud or local reasoning
- local validation

Why this matters:

```text
The real product is not "many nicely abstracted pieces."
The real product is one coherent execution experience for mixed tasks.
```

Visual:

```text
One user task
  -> local read
  -> public research
  -> reasoning
  -> local action
  -> one final result
```

### 15.10 Phase 9: Opt-In Higher Abstraction

Purpose:

- the higher abstraction becomes usable in real sessions without yet becoming
  the forced default

This is the stage where two valid product modes coexist:

```text
Manual:
  user pins provider/model/path

Auto:
  HLVM chooses the path underneath
```

Why this matters:

```text
The platform can mature in public
without breaking the trust of users who still want direct control.
```

### 15.11 Phase 10: Judgment Quality

Purpose:

- HLVM's choices become not merely automatic, but good

This means the system increasingly chooses sensibly across:

- privacy
- locality
- capability fit
- quality
- cost
- availability

Why this matters:

```text
The higher abstraction only deserves to become primary
when its judgment is consistently defensible.
```

### 15.12 Phase 11: Trusted Default

Purpose:

- the platform finally reaches the product shape implied by the thesis

At this point, the common experience becomes:

```text
user states intent + constraints
  -> HLVM chooses the execution strategy
  -> HLVM uses the best allowed/reachable paths
  -> HLVM falls back when needed
  -> user gets one coherent result
```

Manual control still remains first-class.

That remains important even at the end-state.

The destination is not:

```text
remove control
```

The destination is:

```text
make control optional instead of mandatory
```

### 15.13 Why The Staircase Matters

Without this staircase, the platform vision can become vague, theatrical, or
prematurely overgeneralized.

With this staircase, progress can be judged more honestly.

The right question becomes:

```text
Has HLVM become more coherent, more trustworthy, and more task-centered
for the user?
```

not:

```text
Has HLVM invented a more abstract vocabulary?
```

That is the right standard.

### 15.14 Roadmap Decisions Already Locked

The staircase above is conceptual.

The following roadmap decisions are now explicit and should be treated as part
of the plan unless a later design decision deliberately changes them.

#### A. Transitional product posture

- manual mode remains the default path for now
- higher abstraction is opt-in during transition
- manual model/provider choice remains first-class even in the final product

#### B. User entry into higher abstraction

The higher-abstraction path should be entered explicitly rather than
accidentally.

The intended user-facing shape is:

```text
manual:
  current default behavior

auto:
  explicitly requested by the user
```

That means the transitional product should not silently convert all current
manual flows into automatic ones.

#### C. First proof slice

The first real proof of the platform should be the search family:

- `search_web`
- `web_fetch`
- `fetch_url`

This is the correct first slice because it exposes the key architectural
difference between:

- hosted vendor capability
- MCP-mediated capability
- HLVM-local fallback capability

without forcing the entire platform vision to land at once.

#### D. Manual constraint semantics

If the user pins a specific model/provider, that remains a hard constraint.

The runtime may still make lower-level execution choices within that boundary,
but it should not silently violate the pin.

This means, for example:

```text
If the user pins provider X,
vendor-hosted capability use must stay within provider X.
If provider X cannot satisfy that hosted path,
HLVM may fall back to MCP or HLVM-local paths,
but should not silently jump to provider Y hosted infrastructure.
```

#### E. Early scope of abstraction

The first meaning of higher abstraction is:

```text
HLVM chooses better execution paths underneath the task
```

not immediately:

```text
HLVM fully chooses any model from any provider at any time
```

Full reasoning-model abstraction is part of the later staircase, not the first
step.

#### F. Later model-selection posture

When HLVM later begins choosing the reasoning model/provider automatically, the
default priority should be:

```text
configured-first
```

Meaning:

- prefer the user's configured model/provider if it is reachable and adequate
- only switch when the configured path cannot satisfy the task or constraints

This protects continuity and avoids surprising the user.

### 15.15 Explicit Phased Execution Roadmap

The sections above explain why the staircase exists.

This section makes the intended execution plan explicit enough that another
engineer or agent can follow it without redefining the product each time.

#### Phase A. Foundation: Manual Default, Auto Opt-In

The first implementation phase should establish a real execution strategy with
two product meanings:

```text
manual:
  current explicit model/provider-oriented behavior

auto:
  HLVM runtime chooses execution paths underneath the task
```

The important point is that auto mode must be explicitly entered by the user,
while manual remains the normal default until the higher abstraction earns
trust.

This phase should create one session-level runtime picture of:

- active or pinned model/provider
- reachable providers
- reachable MCP services
- allowed vs disallowed path families
- currently valid execution options for the task/session

This phase is not about a grand universal capability taxonomy.
It is about making the runtime aware of the current execution reality.

#### Phase B. Search-Family Pilot

This is the first concrete proof phase.

The runtime should continue exposing HLVM-owned search-family concepts while
allowing the underlying fulfillment path to vary.

The conceptual order in higher-abstraction mode should be:

```text
active provider hosted capability
  -> MCP path
  -> HLVM-local fallback
```

The user's conceptual experience should still be:

```text
"search/read the web"
```

not:

```text
"choose which vendor tool or wire name should do the search"
```

This phase is where the distinction between:

- `search_web`
- vendor-native hosted search
- fallback web search

becomes practically meaningful rather than theoretical.

#### Phase C. Provenance And Trust Surface

Once the search family begins routing dynamically, the system must become
inspectable.

The user and developer should be able to understand:

- what path was used
- what stayed local
- what used hosted infrastructure
- when a fallback was taken

Without this, higher abstraction becomes opaque and untrustworthy.

With it, higher abstraction becomes understandable delegation.

#### Phase D. Additional Capability Families

Only after the search family is stable should the platform repeat the same
shape for additional capability families.

The rule should remain:

```text
one family at a time
```

not:

```text
abstract everything first and hope the behavior emerges later
```

Each new family should preserve the same runtime contract:

- manual mode remains stable
- higher abstraction remains explicit
- hosted/MCP/local choice is runtime-managed
- fallback remains graceful
- provenance remains visible

#### Phase E. Mixed-Task Coherence

Once multiple families exist, HLVM must prove that the platform works for one
mixed task rather than for isolated tool demonstrations.

The true target is a task such as:

```text
read local code
  + research public docs
  + reason about the change
  + make or validate the local result
```

and still make that feel like:

```text
one task
one session
one coherent execution experience
```

This is the point where HLVM begins to look clearly more like a runtime
platform than a provider router.

#### Phase F. Later Reasoning-Model Abstraction

Only after the earlier phases are stable should HLVM begin selecting the
reasoning model/provider automatically for auto mode when the user has not
pinned one.

The intended posture is:

```text
configured-first
```

That means:

- try the user's configured model/provider first
- remain there when it is adequate
- only change when the task or constraints require it

This phase should be treated as later because changing the execution path
underneath a task is much easier to trust than changing the brain itself.

#### Phase G. Trusted Default

Only when the previous phases are strong should higher abstraction become the
default user experience.

At that point, the common experience can become:

```text
user states task + constraints
  -> HLVM chooses the execution strategy
  -> HLVM uses the best currently valid path
  -> HLVM falls back when necessary
  -> user receives one coherent result
```

Even there, manual control remains first-class.

The final destination is:

```text
control becomes optional
```

not:

```text
control disappears
```

### 15.16 Implementation Status: Auto Mode Platform Progress

The thesis above describes the intended staircase.

This subsection records the current implementation status so the thesis can
remain conceptual while the repository still has a concrete progress marker.

#### Manual vs Auto Contract

HLVM currently preserves two product meanings:

```text
manual                        auto
  default                       explicit opt-in
  explicit                      routed
  preserved                     growing platform path
  first-class forever           task-centric abstraction
```

The important point is unchanged:

```text
manual is not legacy
auto is not forced
```

Manual remains the normal default until higher abstraction earns trust.

#### Progress Tracker

This is the operational snapshot of where HLVM stands right now.

```text
Platform journey

  [done]     manual default preserved
  [done]     auto mode introduced as explicit opt-in
  [done]     execution surface foundation
  [done]     web-family routed capability pilot
  [done]     provenance / trust surface
  [done]     execution-surface inspector (/surface command)
  [done]     policy-aware routing
  [done]     second capability family: vision.analyze (attachments-first)
  [done]     mixed-task coherence (web + vision in one turn/session)
  [done]     third capability family: code.exec (provider-native, task-text cues)
  [done]     runtime fallback after selected backend failure
  [done]     fourth capability family: structured.output (provider-native, request-schema driven)
  [done]     targeted validation board + live smoke harness
  [done]     close remaining live-proof gaps (web.search, mixed-turn)
  [done]     fifth capability family: audio.analyze (attachment-driven, 5th family bucket)
  [done]     sixth capability family: computer.use (explicit-request, 6th family bucket)
  [done]     strengthen provider/model capability modeling
  [done]     reasoning model/provider auto-selection (auto-mode, configured-first)
  [done]     eval/hardening for judgment quality (37 eval cases, 7 dimensions)
  [done]     trusted-default posture (/surface hints, /doctor, validation board green)
```

Validation matrix:

```text
capability/family      implemented   integration-validated   live-validated
web.search             yes           yes                     pass (opt-in Google smoke)
web.read               yes           yes                     pass (opt-in Google smoke)
vision.analyze         yes           yes                     pass (opt-in Google smoke)
code.exec              yes           yes                     pass (opt-in Google smoke)
structured.output      yes           yes                     pass (opt-in Google smoke)
audio.analyze          yes           yes                     pass (opt-in Google smoke; MCP capability-proof)
computer.use           yes           yes                     pass (opt-in Anthropic routing smoke; MCP capability-proof)
mixed-turn coherence   yes           yes                     pass (opt-in Google smoke)
fallback               yes           yes                     pass (deterministic runtime proof)
reasoning selector     yes           yes                     pass (opt-in cross-provider smoke)
```

Routing subsystem completeness:

- Provider-native tier: 7/7 families — all have real tool definitions and
  routing decisions derived from resolved capabilities (not hardcoded provider names)
- computer.use SDK path: fully wired through `mergeSdkWebCapabilityTools()`,
  `getProviderExecutedToolNameSet()`, and `getActiveProviderExecutionToolNames()`
- MCP tier: 7/7 families wired — activates with tagged MCP servers
- Execution coverage: 7/7 executable (4 bundled/local + 2 MCP-backed + 1 prompt-based fallback); 0 freezes
- Reasoning selector: live model switching — `selectReasoningPathForTurn()` result
  applied to the actual LLM call in `agent-runner.ts`, not just metadata
- Privacy model: local-only constraint correctly allows local MCP servers
  (stdio transport or localhost HTTP) while blocking remote MCP and provider-native
- TUI visibility: all routing events surfaced — `capability_routed`, `reasoning_routed`
- E2E coverage: audio routing, computer.use routing, structured.output routing, MCP fallback, reasoning selector smoke tests, MCP capability-proof tests

Current scope and future work:

- bundled/local vision: **done** — Ollama vision models (llava, bakllava) via
  local model switching when the pinned Ollama model lacks vision
- bundled/local code exec hardening (sandboxing beyond shell-backed execution) — **future hardening**
- audio.analyze — **executable via MCP** (e.g. whisper-server) or provider-native (Google)
- computer.use — **executable via MCP** (e.g. puppeteer) or provider-native (Anthropic)
- structured.output — **executable** via provider-native > MCP > hlvm-local (prompt-based extraction)

Compact progress view:

```text
done
  web family
  /surface
  task-derived constraints
  vision.analyze on attachments
  multi-family coherence
  code.exec on task cues
  routed backend fallback
  structured.output final synthesis
  validation board + live smoke harness
  close remaining live-proof gaps
  audio.analyze on attachments (5th family bucket)
  computer.use on explicit request (6th family bucket)

done (latest)
  trusted-default posture (/surface hints, /doctor health check)
  eval/hardening for judgment quality (37 cases, 7 dimensions)
  reasoning model/provider auto-selection
  provider/model capability modeling
  reasoning selector live model switching (GAP 1)
  computer.use real provider-native tool wiring (GAP 2)
  local-only privacy model for local MCP servers (GAP 3)
  reasoning_routed TUI + chat stream visibility (GAP 4)
  E2E smoke tests: audio, computer.use, MCP fallback, reasoning, MCP capability-proof
```

Fallback trust flow:

```text
route selected
  -> route failed
  -> fallback selected
  -> provenance + /surface stay aligned
```

Rough maturity snapshot:

```text
Routing DECISION layer (judgment quality)  [####################] 100%
  - 40 deterministic eval cases across 7 dimensions, all passing
  - 3 opt-in routing-proof smokes (audio, computer.use, reasoning-switch)
  - 4 local MCP capability-proof E2Es (audio, computer.use, multi-capability discovery, structured.output)

Backend EXECUTION layer (accepted scope)   [####################] 100%
  - web.search: ✅ DuckDuckGo (search_web)
  - web.read:   ✅ Readability (web_fetch)
  - code.exec:  ✅ local_code_execute (shell-backed local execution; sandbox hardening remains future work)
  - vision:     ✅ Auto-switch to Ollama vision model (llava/bakllava) via reasoning selector
  - audio:      ✅ MCP path (e.g. whisper-server); provider-native (Google)
  - computer:   ✅ MCP path (e.g. puppeteer); provider-native (Anthropic)
  - structured: ✅ provider-native > MCP > hlvm-local (prompt-based extraction)
```

Current staircase position:

```text
roots: solid
trunk: real (routing + policy on proven spine)
first branch: web family (done)
second branch: vision.analyze (done)
coherence layer: done
third branch: code.exec (done)
fallback layer: done
validation layer: done
trusted-default posture: done — /surface hints, /doctor health check
live model switching: done — reasoning selector applies to actual LLM call
privacy model: done — local MCP servers allowed under local-only
TUI visibility: done — all routing events surfaced
routing decision layer: complete. Backend execution: 7/7 executable (4 bundled/local + 2 MCP-backed + 1 prompt-based fallback), 0 freezes.
```

Current fallback posture:

```text
per-turn only
constraint-preserving
trust-surfaced in transcript provenance and /surface
manual remains unchanged
```

#### The Reusable Pattern Per Capability Family

The web family implementation established a 6-step reusable pattern that
every future capability family should follow:

```text
Step 1. Define semantic capability IDs
          web.search, web.read
          vision.analyze
          code.exec
          (later: ...)

Step 2. Survey available backends for the family
          provider-native? MCP-backed? HLVM-local?

Step 3. Build routing decision function
          buildWebSearchDecision(), buildWebReadDecision()
          (later: buildCodeExecDecision(), ...)

Step 4. Implement three-tier cascade
          provider-native → MCP → HLVM-local

Step 5. Emit provenance event
          capability_routed with familyId, strategy, selectedBackendKind

Step 6. Wire into prompt layer
          auto-mode prompt guidance for the family
```

This pattern is proven on the web family and should be replicated rather
than reinvented for each new family.

#### Remaining Roadmap To LLVM-for-LLM

The full journey from current state to the thesis destination:

```text
CURRENT STATE
  ├── ReAct orchestrator               ✓ solid
  ├── Local tool plane (15+ families)   ✓ solid
  ├── Multi-provider adapters           ✓ solid
  ├── MCP client (SDK-backed)           ✓ solid
  ├── RuntimeMode manual/auto           ✓ implemented
  ├── Execution surface                 ✓ implemented
  ├── Web family routing                ✓ implemented
  ├── Vision family routing             ✓ implemented
  ├── Code.exec family routing          ✓ implemented
  ├── Provenance events                 ✓ implemented
  └── /surface inspector                ✓ implemented

DONE: POLICY-AWARE ROUTING
  │
  │   Constraints (local-only, cheap, quality, no-upload) filter
  │   candidates BEFORE selection, not just enforce at execution boundary.
  │
  │   Policy routing matrix:
  │   ┌──────────────┬──────────┬─────────┬────────────┐
  │   │ Constraint   │ Native   │ MCP     │ Local      │
  │   ├──────────────┼──────────┼─────────┼────────────┤
  │   │ local-only   │ blocked  │ blocked │ allowed    │
  │   │ no-upload    │ check    │ check   │ allowed    │
  │   │ cheap        │ depriori │ allowed │ preferred  │
  │   │ quality      │ preferred│ allowed │ depriori   │
  │   └──────────────┴──────────┴─────────┴────────────┘
  │
  │
  │   Implemented details:
  │   - deterministic task-text constraint extraction
  │   - constraints persisted as last-applied session metadata
  │   - execution surface carries constraints + blocked reasons
  │   - /surface shows selected path and why other candidates were blocked
  │   - constrained route selection is validated by targeted unit/integration tests
  │
  ▼
DONE: CODE.EXEC FAMILY
  │
  │   A third family now proves task-text-activated routing on the same
  │   execution-surface/provenance spine.
  │
  │   Scope:
  │   - capability family: code.exec
  │   - activation source: current task text only
  │   - provider-native only in this phase
  │   - no MCP/local backend yet
  │   - turn-start provenance
  │   - /surface shows task capability context + code.exec decision
  │
  │   Key architectural addition:
  │   - task-scoped capability context derived deterministically from the
  │     current user query
  │   - code.exec routes to remote_code_execute only when the pinned
  │     provider/model supports native remote sandbox execution
  │
  ▼
DONE: RUNTIME FALLBACK AFTER SELECTED BACKEND FAILURE
  │   Per-turn, constraint-preserving, trust-surfaced in provenance + /surface
  │
  ▼
NEXT: CLOSE REMAINING LIVE-PROOF GAPS
  │   web.search live proof (known runtime bugs fixed, deterministic
  │   tests green, live rerun still required — currently quota-blocked)
  │   mixed-turn live proof (depends on web.search live green)
  │
  ▼
THEN: FIFTH CAPABILITY FAMILY — audio.analyze
  │   Same 6-step pattern as prior families
  │   Provider-native backends: Google, OpenAI audio/speech APIs
  │
  ▼
THEN: SIXTH CAPABILITY FAMILY — computer.use
  │   Anthropic computer_use as provider-native path
  │   Same 6-step pattern
  │
  ▼
THEN: STRENGTHEN PROVIDER/MODEL CAPABILITY MODELING
  │   Enabling workstream for reasoning auto-selection
  │   ProviderCapability must grow beyond coarse feature list
  │   Needs: hosted tool families, media in/out, structured outputs,
  │   citations/grounding, realtime modes
  │
  ▼
THEN: REASONING MODEL/PROVIDER AUTO-SELECTION
  │   auto-mode only
  │   configured-first: prefer user's pinned model
  │   choose once at turn start — no mid-turn brain switching
  │   only switch when pinned path cannot satisfy the task
  │
  ▼
THEN: EVAL/HARDENING FOR JUDGMENT QUALITY
  │   Not a single build phase — ongoing eval layer over routing +
  │   reasoning selection
  │   Covers: privacy, locality, capability fit, quality, cost, availability
  │
  ▼
THEN: TRUSTED-DEFAULT POSTURE
  │   /surface guidance hints: locked/missing items show how to unlock
  │     e.g. "Set GOOGLE_API_KEY to enable Google-hosted search"
  │   /doctor: environment-level health check
  │     e.g. "Ollama: running, 3 models | Anthropic: key set | OpenAI: no key"
  │   Full validation board green
  │   Auto trustworthy enough to recommend as default
  │   Manual control remains first-class override
```

#### Auto Mode Alpha: Implemented

The first reusable platform slice is now implemented.

Specifically:

- session-scoped `runtimeMode: manual|auto`
- persisted runtime mode per conversation/session
- execution-surface foundation for the active session
- web-family routing foundation
- routed provenance via `capability_routed`

In practical terms, HLVM now has a reusable middle-layer pattern rather than a
web-only hack:

```text
manual or auto
  -> execution surface
  -> semantic capability routing
  -> selected backend path
  -> provenance / trust surface
```

#### Current Web Status

The web family is the first capability family plugged into that pattern.

The current contract is:

```text
web.search
web.read
```

with the active backend cascade now intended as:

```text
provider-native
  -> MCP-backed
  -> HLVM-local
```

This is the first real proof that HLVM can route a semantic family rather than
only call concrete tool names directly.

#### What Was Validated

The implementation has targeted validation, not blanket certification.

Validated so far:

- runtime mode defaults to `manual`
- runtime mode persists per active conversation session
- execution-surface routing logic for the web family
- turn-scoped capability context for attachment-driven routing
- provider-native vision routing for `vision.analyze`
- turn-start provenance for attachment-driven routing
- deterministic task-text capability extraction for `code.exec`
- provider-native routing for `code.exec` when remote sandbox support exists
- turn-start provenance for task-text-activated routing
- provider-native preference when available
- MCP participation only through explicit HLVM-owned semantic bindings
- HLVM-local fallback when native/MCP are unavailable
- runtime API support for the active conversation execution surface

Validation status should be understood as:

```text
implemented: yes
targeted unit/integration verification: yes
full battle-tested maturity: not yet
```

#### Remaining Gaps In This Stage

The foundation is real, but this is not yet the fully-finished platform.

Still missing or still immature relative to the long-term thesis:

- ~~policy-aware routing~~ (done — constraints filter candidates before selection)
- ~~runtime fallback after a chosen backend fails mid-task~~ (done)
- ~~broader family coverage beyond the web family~~ (done — `vision.analyze`)
- ~~full mixed-task coherence across multiple families~~ (done)
- ~~third capability family~~ (done — `code.exec`)
- ~~reasoning-model/provider auto-selection~~ (done — configured-first, auto-mode)
- ~~trusted-default posture~~ (done — /surface hints, /doctor health check)

So the right framing is:

```text
first strong reusable platform slice: done
policy-aware routing: done
second capability family: done
third capability family: done
routing decision layer: complete. Backend execution: 7/7 executable (4 bundled/local + 2 MCP-backed + 1 prompt-based fallback), 0 freezes.
```

#### Before / Now / Next / Final

```text
BEFORE
  manual model/provider choice
  concrete tools
  limited visibility into backend choice
  no semantic capability layer
  no concept of execution surface

NOW
  manual default preserved
  auto opt-in introduced
  execution surface exists and is inspectable (/surface)
  semantic capability routing exists (web.search, web.read)
  web family fully routed: provider-native → MCP → HLVM-local
  provenance exists (capability_routed events)
  first reusable platform slice proven on web family
  policy-aware routing implemented (constraints filter candidates)
  turn-scoped capability context implemented for attachments
  vision.analyze implemented (provider-native, attachment-driven, turn-start provenance)
  mixed-task coherence implemented across web + vision in one turn/session
  task-scoped capability context implemented for compute cues
  code.exec implemented (provider-native, task-text activated, turn-start provenance)
  runtime fallback implemented (per-turn, constraint-preserving, trust-surfaced)
  response-shape context implemented for explicit final schemas
  structured.output implemented (provider-native, request-schema driven, final-response executed)

NOW (all complete)
  live-proof gaps closed (web.search, mixed-turn)
  broader family coverage complete (audio.analyze, computer.use)
  provider/model capability modeling done
  reasoning model/provider auto-selection done (configured-first, auto-mode only)
  eval/hardening done (37 eval cases, 7 dimensions)
  trusted-default posture reached
  /surface shows guidance hints for unlocking capabilities
  /doctor for environment-level health checks
  auto trustworthy enough to recommend
  manual remains first-class override forever
```

#### Platform Visual

Current foundation architecture:

```text
┌──────────────────────────────────────────────────────────────┐
│                        User Task                             │
│                     + constraints                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  Runtime Mode                                │
│               manual (default) / auto (opt-in)               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  Execution Surface                           │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Active     │ │ Reachable  │ │ Local    │ │ MCP        │  │
│  │ Provider   │ │ Providers  │ │ Models   │ │ Servers    │  │
│  └────────────┘ └────────────┘ └──────────┘ └────────────┘  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│            Policy Filter [done]                              │
│  local-only? no-upload? cheap? quality?                      │
│  → eliminates invalid candidates before selection            │
│  → /surface shows blocked reasons per candidate              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│            Semantic Capability Routing                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐     │
│  │ web.search   │  │ web.read     │  │ vision.analyze │     │
│  │   [done]     │  │   [done]     │  │   [done]       │     │
│  │              │  │              │  │ attach-first   │     │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┐     │
│         │                 │                  │        │     │
│         │                 │            ┌─────▼─────┐  │     │
│         │                 │            │ code.exec │  │     │
│         │                 │            │  [done]   │  │     │
│         │                 │            │ cue-based │  │     │
│         │                 │            └─────┬─────┘  │     │
│         │                 │                  │        │     │
│         │                 │        ┌─────────▼────────┐     │
│         │                 │        │ structured.output │     │
│         │                 │        │      [done]       │     │
│         │                 │        │ request-schema    │     │
└─────────┼─────────────────┼────────┼────────────────────────┘
          │                 │        │
          ▼                 ▼        ▼
┌──────────────────────────────────────────────────────────────┐
│            Backend Selection / Execution Paths                │
│                                                              │
│  1. provider-native  (Anthropic/Google/OpenAI hosted tools)  │
│  2. MCP-backed       (user's configured MCP servers)         │
│  3. HLVM-local       (built-in local tool fallback)          │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              Provenance / Trust Surface                       │
│  capability_routed event: familyId, strategy,                │
│  selectedBackendKind, fallbackReason                         │
│  → visible via /surface inspector                            │
└──────────────────────────────────────────────────────────────┘
```

Implemented files:

```text
runtime-mode.ts          RuntimeMode type, manual default
execution-surface.ts     Routing decisions, three-tier cascade
execution-surface-runtime.ts  Surface refresh from live state
semantic-capabilities.ts Capability IDs, MCP metadata reading
routing-constraints.ts   Task-text constraint extraction + types
task-capability-context.ts  Task-text code.exec activation context
orchestrator.ts          capability_routed event emission
session.ts               runtimeMode threaded through session
agent-runner.ts          Provenance + constraint extraction
sections.ts              Auto-mode prompt guidance
ExecutionSurfaceOverlay.tsx  /surface inspector UI (constraints + blocked)
```

#### This Phase Added

This implementation phase adds:

```text
Targeted E2E / Live Validation Layer
```

Meaning:

- README now separates `implemented`, `integration-validated`, and
  `live-validated` status
- the existing native-provider smoke harness now understands routed capability
  events, inline attachment fixtures, and structured agent results
- provider-backed opt-in smoke tests now exist for:
  - `web.search`
  - `web.read`
  - `vision.analyze`
  - `code.exec`
  - `structured.output`
  - mixed-turn coherence across `vision.analyze` + `web.search`
- deterministic runtime tests now prove that routed fallback emits the real
  `fallback` provenance event and recomputes the execution surface
- live validation is now explicit about what is green vs what is still blocked
  on provider/runtime behavior

#### Completed: Policy-Aware Routing

Policy-aware routing is now implemented. Constraints such as `local-only`,
`cheap`, `quality`, `no-upload` filter candidates before selection.

Implementation details:

- deterministic task-text constraint extraction
- constraints persisted as last-applied session metadata
- execution surface carries constraints and blocked reasons
- /surface shows selected path and why other candidates were blocked
- constrained route selection validated by targeted unit/integration tests

The architectural change that was made:

```text
BEFORE:
  execution-surface.ts selected candidates by availability only
  policy.ts enforced allow/deny at execution boundary (too late)

AFTER:
  policy constraints filter candidates BEFORE selection
  execution-surface.ts receives pre-filtered candidate list
  policy is a routing input, not just an enforcement gate
```

#### Validation Runbook

Recommended targeted validation commands that are green on the current branch:

```text
deno test --allow-all tests/integration/http-server.test.ts --filter 'fallback route event and recomputes the execution surface'
HLVM_E2E_NATIVE_PAGE_READ=1 deno test --allow-all tests/e2e/native-web-page-read-smoke.test.ts
HLVM_E2E_NATIVE_VISION=1 deno test --allow-all tests/e2e/native-vision-analyze-smoke.test.ts
HLVM_E2E_NATIVE_REMOTE_CODE=1 deno test --allow-all tests/e2e/native-remote-code-smoke.test.ts
HLVM_E2E_NATIVE_STRUCTURED_OUTPUT=1 deno test --allow-all tests/e2e/native-structured-output-smoke.test.ts
deno test --allow-all tests/unit/agent/orchestrator-response.test.ts --filter 'plain-text function-style tool call'
```

Experimental follow-up commands for currently open live-proof gaps:

```text
HLVM_E2E_NATIVE_WEB_SEARCH=1 deno test --allow-all tests/e2e/native-web-search-smoke.test.ts
HLVM_E2E_NATIVE_GOOGLE_WEB_SEARCH=1 deno test --allow-all tests/e2e/native-google-web-search-smoke.test.ts
HLVM_E2E_NATIVE_MIXED_PLATFORM=1 deno test --allow-all tests/e2e/native-mixed-platform-smoke.test.ts
```

#### Recommended Next Phase: Close Remaining Live-Proof Gaps

The next step is to make the currently open live proofs green before claiming
the routed platform spine is fully E2E-proven. Four families are already
implemented on the same spine:

```text
web.*           tool-start routed
vision.analyze  turn-start, attachment-driven
code.exec       turn-start, task-text activated
structured.output turn-start requested, final-response executed
```

The next architectural gap is broader task coverage on top of the now-proven
multi-family path.

```text
four-family routed runtime
  -> validated by runtime integration tests
  -> covered by opt-in provider-backed live smokes
  -> ready for the next semantic family
```

After targeted validation (all complete):

- ~~fifth capability family: audio.analyze~~ done
- ~~sixth capability family: computer.use~~ done
- ~~strengthen provider/model capability modeling~~ done
- ~~reasoning model/provider auto-selection~~ done
- ~~eval/hardening for judgment quality~~ done
- ~~trusted-default posture~~ done

#### /surface And /doctor: Visibility Layer

Two complementary visibility tools serve different scopes:

```text
/surface (implemented)
  Session-level routing view
  Shows which backends are active, which capabilities are routed
  Shows all 7 capabilities in Active Turn Routing and Capabilities sections
  Shows unlock hints for capabilities with no selected route
    e.g. "-> unlock: Switch to Google Gemini for native audio input support."

/doctor (implemented)
  Environment-level health check
  Shows overall system readiness independent of any session
    e.g. "ok ollama: 3 models installed"
    e.g. "ok anthropic (pinned)"
    e.g. "!! openai — no API key"
    e.g. "!! audio.analyze: no route"
    e.g. "   -> Switch to Google Gemini for native audio input support."
  Actionable unlock hints for capabilities with no selected route
```

---

## 16. The Important `search_web` Clarification

This example is central because it illustrates both the progress already made
and the remaining gap.

### 16.1 What `search_web` gets right

HLVM already has:

- its own tool name
- its own arguments
- its own guidance
- its own fallback implementation

That means HLVM is not simply exposing raw vendor wire names to the model.

That is good.

### 16.2 What `search_web` now demonstrates

Updated: 2026-03-31

With the web family routing implementation, `search_web` is no longer just
one concrete HLVM tool. It is now:

```text
one semantic capability (web.search)
  -> multiple backend realizations
```

The runtime now chooses among:

- hosted vendor search (provider-native)
- MCP search (user's configured MCP servers)
- HLVM `search_web` (local fallback)

This is the first proof that the semantic capability abstraction works in
practice. The same pattern needs to be replicated for additional families.

### 16.3 Why naming still matters

The difference between:

- `search_web`
- `web_search`
- `google_search`

does matter at the adapter layer.

It should not matter to the top-level runtime logic.

That is the distinction to preserve.

---

## 17. Where HLVM Is Today

Updated: 2026-03-31

The current codebase is best described as:

```text
strong agent runtime
+ strong local tool plane
+ decent multi-provider model plumbing
+ semantic capability routing (web.*, vision.analyze, code.exec, structured.output, audio.analyze, computer.use)
+ execution surface and provenance infrastructure
+ policy-aware routing (constraints filter before selection)
+ turn-scoped attachment, task, and response-shape context in the routing spine
+ per-turn runtime fallback after routed backend failure
+ mixed-task coherence across web + vision
```

Or, in one sentence:

```text
Today HLVM has a strong runtime with a complete routing decision layer
across 7 semantic capabilities, plus accepted-scope execution coverage
of 7/7 executable capabilities and 0 freezes.
```

That is the most honest summary.

### 17.1 What is already strong

#### A. HLVM already owns the outer runtime loop

Relevant files:

- [src/hlvm/agent/orchestrator.ts](../../src/hlvm/agent/orchestrator.ts)
- [src/hlvm/agent/orchestrator-tool-execution.ts](../../src/hlvm/agent/orchestrator-tool-execution.ts)

This matters enormously because the outer loop is where:

- task continuity
- permission gating
- delegation
- turn management
- retry semantics
- compaction and state handling

already live.

That means HLVM already owns the correct region of the stack for becoming a
higher-level runtime platform.

#### B. HLVM already owns a meaningful local tool plane

Relevant file:

- [src/hlvm/agent/registry.ts](../../src/hlvm/agent/registry.ts)

The registry already consolidates tool families such as:

- file tools
- code tools
- shell tools
- web tools
- memory tools
- git tools
- delegation/team tools

This is one of HLVM's strongest assets because local execution remains a core
part of the platform thesis.

#### C. HLVM already has a provider-facing abstraction layer

Relevant file:

- [src/hlvm/providers/types.ts](../../src/hlvm/providers/types.ts)

The existence of a central provider contract means HLVM is already not
hard-wired to one vendor's API.

#### D. HLVM already has a shared SDK-backed provider runtime

Relevant file:

- [src/hlvm/providers/sdk-runtime.ts](../../src/hlvm/providers/sdk-runtime.ts)

This is a good lower layer because it reduces repeated provider-wire plumbing
and centralizes message/tool conversion.

#### E. HLVM already has its own internal tool vocabulary

Examples:

- `search_web`
- `web_fetch`
- `fetch_url`
- `read_file`
- `write_file`
- `search_code`
- `shell_exec`

This is important because it means the system already reasons partly in its own
language rather than only in vendor wire names.

### 17.2 What is still partial or shallow

#### A. Provider capability modeling is still shallow

The current `ProviderCapability` union in
[src/hlvm/providers/types.ts](../../src/hlvm/providers/types.ts) is limited to:

- `generate`
- `chat`
- `embeddings`
- model list/pull/remove/catalog
- `vision`
- `tools`
- `thinking`

This is enough for a lower provider layer.

It is not enough for a task-level runtime platform that must care about:

- hosted tool families
- realtime modes
- background jobs
- structured outputs
- citations/grounding
- storage/resume
- media in/out

#### B. The cloud capability picture is too coarse for semantic routing

Relevant file:

- [src/hlvm/providers/cloud-provider.ts](../../src/hlvm/providers/cloud-provider.ts)

The shared cloud provider factory stamps cloud providers with a small common set
of capabilities.

That is acceptable for generic provider wiring.

It is not enough if HLVM needs to answer questions like:

- which backend can perform public web search?
- which backend can do hosted code execution?
- which backend can do structured output well?
- which backend can supply grounding metadata?

#### C. Semantic capability routing now spans multiple families, but breadth is still incomplete

The web family now has full semantic routing:

- [src/hlvm/agent/execution-surface.ts](../../src/hlvm/agent/execution-surface.ts)
- [src/hlvm/agent/semantic-capabilities.ts](../../src/hlvm/agent/semantic-capabilities.ts)

The routed platform now covers four semantic family shapes:

- `web.search` / `web.read` via provider-native → MCP → HLVM-local
- `vision.analyze` as attachment-driven, turn-start routing
- `code.exec` as task-text-driven, turn-start routing
- `structured.output` as request-schema-driven, final-response execution

This proves the pattern is generic, not web-specific.

What still remains is breadth and hardening: more families, more real mixed
tasks, and stronger live validation.

#### D. Policy now participates in routing (implemented)

Policy constraints now filter candidates before selection:

- deterministic task-text constraint extraction
- constraints persisted as last-applied session metadata
- execution surface carries constraints and blocked reasons
- /surface shows selected path and why other candidates were blocked

This was previously the single most important architectural gap. It is now
closed.

### 17.3 What has been built and what remains

Built since original writing:

- semantic capability layer (web.search, web.read) with three-tier cascade
- backend-choice layer across local, hosted, and MCP paths
- policy-aware routing (constraints filter candidates before selection)
- execution surface with availability awareness
- provenance and trust surface (capability_routed events)
- /surface inspector for visibility into routing decisions
- turn-scoped capability context for attachment-driven routing
- `vision.analyze` as a second family (attachments-first, provider-native)
- mixed-task coherence across web + vision in one turn/session
- task-scoped capability context for code.exec activation
- `code.exec` as a third family (provider-native, task-text activated)
- runtime fallback after routed backend failure (per-turn, narrow, trust-surfaced)
- response-shape context for explicit structured final responses
- `structured.output` as a fourth family (provider-native, request-schema driven)

All complete:

- ~~reasoning model/provider auto-selection~~ (done — configured-first, auto-mode only)
- ~~eval/hardening for judgment quality~~ (done — 37 eval cases, 7 dimensions)
- ~~trusted-default posture~~ (done — /surface hints, /doctor health check)

The routing decision layer is complete. Backend execution is 2/7 implemented (web.search, web.read), with 5 intentional stubs.

---

## 18. What Should Be Preserved

The right move is not a big discard.

Preserve:

- the HLVM-owned orchestrator
- the HLVM local tool plane
- provider adapters as lower layers
- native structured tool-calling
- local-first behavior
- permission gating
- deterministic safety boundaries
- delegation and team runtime semantics
- HLVM-owned continuity over the task

If a future abstraction proposal simplifies provider wiring but weakens those
properties, it is not progress.

---

## 19. What Should Be Re-Layered

Provider abstraction should be treated as:

```text
necessary lower layer
```

not:

```text
the final platform layer
```

HLVM tool names should increasingly be understood as:

- concrete HLVM implementations
- or concrete backend surfaces

rather than as the final semantic unit of orchestration.

The capability model should evolve from a coarse provider-feature list into
something that can support runtime choice over:

- local tools
- hosted tools
- MCP tools
- model tiers
- policy constraints

---

## 20. What Must Remain True

- HLVM should not merely choose a model.
- HLVM should choose how the whole task gets executed.
- The higher abstraction is the destination.
- Manual model/provider choice remains a real first-class feature.
- During transition, manual choice may remain primary.
- The higher abstraction may remain opt-in until it is stable enough to trust.
- The path to the higher abstraction should be understood as staged
  prerequisites rather than as one monolithic leap.
- The user should eventually be able to speak mostly in task language.
- The system must respect privacy, locality, and user constraints.
- The same conceptual task should remain coherent across different backend sets.

---

## 21. Final Summary

Updated: 2026-03-31

HLVM should be understood as "LLVM for LLM" — the central platform that any
input frontend, any AI model, any tool backend, and any policy plugs into.
Like LLVM is the central hub in the compiler ecosystem, HLVM is the central
hub in the LLM ecosystem:

```text
any input → orchestrator + policy + routing → any backend
```

This does not eliminate the need for lower layers such as provider adapters,
local tools, or MCP connections. It elevates them into inputs to a higher
semantic execution layer.

The current codebase now contains a proven multi-family platform slice:

- ReAct orchestrator (the "IR" — general enough for any task)
- Execution surface (session-level availability awareness)
- Semantic capability routing (`web.*`, `vision.analyze`, `code.exec`, `structured.output`, `audio.analyze`, `computer.use`)
- Policy-aware candidate filtering (constraints applied before selection)
- Provenance events (capability_routed with full routing rationale)
- /surface inspector (visibility into routing decisions)
- Mixed-task coherence across turn-start + tool-start families
- Per-turn runtime fallback after routed backend failure

The routing milestone is complete under the current accepted scope. The
staircase items below are all resolved:

1. ~~Close remaining live-proof gaps (web.search, mixed-turn)~~ done
2. ~~Add broader capability families (audio.analyze, computer.use)~~ done
3. ~~Strengthen provider/model capability modeling~~ done
4. ~~Add reasoning model/provider auto-selection (configured-first, auto-mode)~~ done
5. ~~Eval/hardening for judgment quality~~ done (37 cases, 7 dimensions)
6. ~~Reach trusted-default posture~~ done (/surface hints, /doctor)

All routing decision milestones reached. Backend execution: 7/7 executable (4 bundled/local + 2 MCP-backed + 1 prompt-based fallback), 0 freezes.

The transitional product may still keep manual model/provider choice as the
primary path until the higher abstraction is stable enough to trust. The route
to the end-state should be understood as a staircase of prerequisite layers,
not as one giant all-at-once transformation.

---

## 22. Pipeline Visual: Current State vs 100% Destination

Updated: 2026-03-31

### 22.1 What Exists Today (Current Pipeline)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER TASK                                     │
│                                                                         │
│  "Research X"    "Fix this bug"    "Analyze image"    "Run this code"   │
│  + optional constraints: local-only, cheap, quality, no-upload          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RUNTIME MODE GATE                                │
│                                                                         │
│   manual (default)                    auto (explicit opt-in)            │
│     user pins model/provider            HLVM routes underneath          │
│     tools execute as-is                 capabilities routed             │
│     no semantic routing                 provenance emitted              │
│     first-class forever                 growing platform path           │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ (auto mode)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CONTEXT EXTRACTION                                  │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Turn Context    │  │  Task Capability  │  │  Response Shape      │   │
│  │  ─────────────   │  │  Context          │  │  Context             │   │
│  │  attachments?    │  │  ──────────────── │  │  ────────────────    │   │
│  │  attachment      │  │  "calculate"      │  │  explicit schema     │   │
│  │    kinds?        │  │  "hash" "regex"   │  │    requested?        │   │
│  │  vision-         │  │  "python snippet" │  │  top-level keys?     │   │
│  │    eligible?     │  │  → code.exec cue  │  │  → structured.output │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Routing Constraints                                            │    │
│  │  ───────────────────                                            │    │
│  │  hard: local-only, no-upload                                    │    │
│  │  preference: cheap, quality                                     │    │
│  │  source: task text (deterministic extraction)                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXECUTION SURFACE                                  │
│                                                                         │
│  Session-level snapshot of what is reachable and allowed                 │
│                                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Active       │ │ Reachable    │ │ Local        │ │ MCP          │   │
│  │ Provider     │ │ Providers    │ │ Models       │ │ Servers      │   │
│  │ (pinned)     │ │ (all keys)   │ │ (Ollama)     │ │ (configured) │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                                         │
│  Inspectable via /surface command                                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    POLICY FILTER (done)                                  │
│                                                                         │
│  Constraints eliminate invalid candidates BEFORE selection               │
│                                                                         │
│  ┌──────────────┬──────────┬─────────┬────────────┐                    │
│  │ Constraint   │ Native   │ MCP     │ Local      │                    │
│  ├──────────────┼──────────┼─────────┼────────────┤                    │
│  │ local-only   │ blocked  │ blocked │ allowed    │                    │
│  │ no-upload    │ check    │ check   │ allowed    │                    │
│  │ cheap        │ depriori │ allowed │ preferred  │                    │
│  │ quality      │ preferred│ allowed │ depriori   │                    │
│  └──────────────┴──────────┴─────────┴────────────┘                    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               SEMANTIC CAPABILITY ROUTING                               │
│                                                                         │
│  7 capabilities across 6 family buckets:                                │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ web family                                                       │   │
│  │                                                                  │   │
│  │ web.search ─── tool-start routed                                 │   │
│  │   backends: provider-native → MCP → HLVM-local (search_web)     │   │
│  │   activation: model requests web search tool                     │   │
│  │   live proof: GREEN                                              │   │
│  │                                                                  │   │
│  │ web.read ──── tool-start routed                                  │   │
│  │   backends: provider-native → MCP → HLVM-local (web_fetch)      │   │
│  │   activation: model requests page read tool                      │   │
│  │   live proof: GREEN                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ vision family                                                    │   │
│  │                                                                  │   │
│  │ vision.analyze ─── turn-start routed                             │   │
│  │   backends: provider-native → MCP → HLVM-local (Ollama vision)  │   │
│  │   activation: attachments present + vision-eligible kinds        │   │
│  │   live proof: GREEN                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ code family                                                      │   │
│  │                                                                  │   │
│  │ code.exec ──── turn-start routed                                 │   │
│  │   backends: provider-native → MCP → HLVM-local (local_code_execute) │ │
│  │   activation: task-text cues ("calculate", "hash", "regex", ...) │   │
│  │   live proof: GREEN                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ structured family                                                │   │
│  │                                                                  │   │
│  │ structured.output ─── turn-start requested, final-response exec  │   │
│  │   backends: provider-native (structured output support)          │   │
│  │   activation: explicit response schema in request                │   │
│  │   live proof: GREEN                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ audio.analyze              [done]                               │   │
│  │   backends: provider-native (Google) → MCP (e.g. whisper)      │   │
│  │   activation: audio attachments present (attachment-driven)     │   │
│  │   live proof: GREEN (Google smoke + MCP capability-proof)       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ computer.use              [done]                                │   │
│  │   backends: provider-native (Anthropic) → MCP (e.g. puppeteer) │   │
│  │   activation: explicit ChatRequest.computer_use=true            │   │
│  │   live proof: GREEN (Anthropic smoke + MCP capability-proof)    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              THREE-TIER BACKEND CASCADE                                  │
│                                                                         │
│  Per capability, ordered by preference:                                  │
│                                                                         │
│  1. provider-native    vendor-hosted tool (Anthropic/Google/OpenAI)     │
│  2. MCP-backed         user's configured MCP server for that capability │
│  3. HLVM-local         built-in local tool fallback                     │
│                                                                         │
│  Constraint "cheap" swaps to: HLVM-local → MCP → provider-native       │
│                                                                         │
│  Runtime fallback: if selected backend fails mid-turn,                  │
│    retry down the cascade without violating constraints                  │
│    provenance tracks the failure + fallback path                        │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              PROVENANCE / TRUST SURFACE                                 │
│                                                                         │
│  capability_routed event emitted with:                                  │
│    familyId, capabilityId, strategy, selectedBackendKind,               │
│    routePhase (turn-start | tool-start | fallback),                     │
│    failedBackendKind, failureReason, fallbackReason                     │
│                                                                         │
│  Visible via /surface inspector                                         │
│  Citation pipeline: sources → provenance:"provider" → citationSpans    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          RESULT                                         │
│                                                                         │
│  Coherent response with:                                                │
│    text output + tool results + citations + provenance metadata          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 22.2 What Was Missing And Is Now Closed

```text
CURRENT STATUS OF PREVIOUS GAPS

  1. Brain is fixed per session — PARTIALLY RESOLVED
     ┌─────────────────────────────────────────────────────────┐
     │ User pins model/provider at session start               │
     │ In auto mode, reasoning selector can recommend a        │
     │   different provider when pinned model provably cannot  │
     │   satisfy the turn's capability requirements            │
     │ Configured-first: no switch unless necessary            │
     │ Selection is per-turn, not mid-turn                     │
     └─────────────────────────────────────────────────────────┘

  2. 6 family buckets on the routing spine — RESOLVED
     ┌─────────────────────────────────────────────────────────┐
     │ web, vision, code, structured, audio, computer          │
     │ all 6 families implemented and on the spine             │
     │ final family count is not fixed                         │
     └─────────────────────────────────────────────────────────┘

  3. Provider capability modeling — RESOLVED
     ┌─────────────────────────────────────────────────────────┐
     │ ProviderCapability now includes:                        │
     │   generate | chat | embeddings | vision | tools |       │
     │   thinking | models.* | hosted.webSearch |              │
     │   hosted.codeExecution | hosted.computerUse |           │
     │   media.audioInput | structured.output |                │
     │   citations.grounding                                   │
     │                                                         │
     │ + ModelCostTier (free/cheap/standard/premium)           │
     │ + Per-provider capability declarations                  │
     │ + Extended ModelCapabilityFlags for UI                  │
     └─────────────────────────────────────────────────────────┘

  4. Eval/hardening for judgment quality — RESOLVED
     ┌─────────────────────────────────────────────────────────┐
     │ 37 deterministic eval cases across 7 dimensions:        │
     │   includes explicit MCP fallback coverage for audio      │
     │   and local-vision reasoning-switch coverage             │
     │ All cases pass against buildExecutionSurface()          │
     │ Framework in routing-eval.ts + tests/eval/              │
     └─────────────────────────────────────────────────────────┘

  5. Trusted-default posture — RESOLVED for the current milestone
     ┌─────────────────────────────────────────────────────────┐
     │ Manual remains the default by product choice            │
     │ Auto routing is complete for the accepted scope         │
     │ /surface shows unlock guidance                          │
     │ /doctor exists                                          │
     └─────────────────────────────────────────────────────────┘
```

### 22.3 100% Destination Pipeline (Future / Ideal)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER TASK                                     │
│                                                                         │
│  "Research X"  "Fix bug"  "Analyze audio"  "Use the computer"          │
│  + optional constraints                                                 │
│  User thinks in TASKS, not providers/models/tools                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RUNTIME MODE GATE                                │
│                                                                         │
│   manual (first-class forever)        auto (TRUSTED DEFAULT)            │
│     user pins model/provider            HLVM handles everything         │
│     override, not legacy                task-centric abstraction        │
│     "control is optional,               "state the task, get the        │
│      not absent"                         result"                        │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ (auto mode — default in final state)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CONTEXT EXTRACTION                                  │
│                     (same as today, extended)                            │
│                                                                         │
│  Turn context + task capability context + response shape context        │
│  + routing constraints                                                  │
│  + NEW: audio/media context + computer interaction context              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 ┌─────────────────────────────────────┐                 │
│                 │  REASONING MODEL/PROVIDER            │                 │
│                 │  AUTO-SELECTION (NEW)                │                 │
│                 │                                      │                 │
│                 │  configured-first strategy:           │                 │
│                 │    prefer user's pinned model         │                 │
│                 │    only switch when pinned can't      │                 │
│                 │      satisfy the task                 │                 │
│                 │                                      │                 │
│                 │  auto-mode only                      │                 │
│                 │  choose once at turn start           │                 │
│                 │  no mid-turn brain switching         │                 │
│                 │                                      │                 │
│                 │  requires: rich capability modeling  │                 │
│                 └─────────────────────────────────────┘                 │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      EXECUTION SURFACE                                  │
│                      (same as today, richer)                            │
│                                                                         │
│  + rich provider/model capability modeling                              │
│    (hosted tool families, media, structured, citations, cost tiers)     │
│  + /surface with unlock guidance hints                                  │
│  + /doctor for environment health check                                 │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    POLICY FILTER (same as today)                        │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               SEMANTIC CAPABILITY ROUTING (FULL)                        │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ web.*    │  │ vision.* │  │ code.*   │  │structured│  │ audio.*  │ │
│  │ [done]   │  │ [done]   │  │ [done]   │  │ [done]   │  │ [done]   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│  ┌──────────┐  ┌──────────────────────────┐                           │
│  │computer.*│  │ (future families as       │                           │
│  │ [done]   │  │  needed)                  │                           │
│  │ [TODO]   │  │ [TODO]   │  │  ecosystem evolves)       │             │
│  └──────────┘  └──────────┘  └──────────────────────────┘             │
│                                                                         │
│  Each family: same 6-step pattern, same three-tier cascade              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              THREE-TIER BACKEND CASCADE (same)                          │
│  provider-native → MCP → HLVM-local                                    │
│  + runtime fallback (done)                                              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              PROVENANCE / TRUST SURFACE (same + enhanced)               │
│  + /surface with unlock guidance                                        │
│  + /doctor                                                              │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              EVAL / JUDGMENT QUALITY LAYER (NEW)                        │
│                                                                         │
│  Ongoing measurement of routing + selection decisions:                   │
│    Was the chosen path actually better?                                 │
│    Privacy respected? Locality preserved? Cost sensible?                │
│    Quality adequate? Capability fit correct?                            │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          RESULT                                         │
│                                                                         │
│  User stated intent → HLVM handled execution → coherent result          │
│  Manual override available at every layer                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 22.4 Side-By-Side: Current vs 100%

```text
                    CURRENT                          100% DESTINATION
                    ───────                          ────────────────
Brain selection     user pins model/provider         auto-selects (configured-first)
                    fixed per session                choose at turn start

Family coverage     4 buckets, 5 capabilities        6+ buckets (audio, computer, ...)
                    web, vision, code, structured    final count not fixed

Provider modeling   coarse (generate/chat/vision/    rich (hosted tools, media,
                      tools/thinking)                  structured, citations, cost)

Judgment eval       none                             ongoing eval layer

Default mode        manual                           auto (trusted)
                    auto = explicit opt-in            manual = first-class override

/surface            shows status                     shows status + unlock guidance

/doctor             does not exist                   environment health check

Live proof          3 green, 2 open                  full validation board green
```

### 22.5 How To Get There: Canonical TODO

```text
TODO #   What                                             Depends On
──────   ────                                             ──────────
  1      Close web.search live proof                      quota reset / paid key
           known runtime bugs fixed
           targeted deterministic tests green
           live rerun still required

  2      Close mixed-turn live proof                      #1 green
           depends on web.search live green
           on same provider path

  3      Add audio.analyze family                         #1, #2 closed
           6-step pattern
           provider-native: Google, OpenAI audio APIs
           new SemanticCapabilityId
           new CapabilityFamilyId
           new routing decision function
           new task-capability cues

  4      Add computer.use family                          #3 done
           6-step pattern
           provider-native: Anthropic computer_use
           new SemanticCapabilityId
           new CapabilityFamilyId

  5      Strengthen provider/model capability modeling    #3, #4 done
           enabling workstream for #6
           ProviderCapability grows beyond coarse list
           hosted tool families, media in/out,
             structured outputs, citations, cost tiers

  6      Reasoning model/provider auto-selection          #5 done
           auto-mode only
           configured-first strategy
           choose once at turn start
           no mid-turn brain switching

  7      Eval/hardening for judgment quality               #6 done
           not a single build phase
           ongoing eval layer
           privacy, locality, capability fit,
             quality, cost, availability

  8      Trusted-default posture                          #6, #7 mature
           /surface unlock guidance hints
           /doctor environment health check
           full validation board green
           auto trustworthy enough to recommend
           manual remains first-class override forever
```

### 22.6 Implementation Groups

```text
Group A: follow established 6-step pattern         (can build now)
  #3 audio.analyze
  #4 computer.use

Group B: infrastructure, not code                   (unblocks itself)
  #1 web.search live proof
  #2 mixed-turn live proof

Group C: architectural shift — brain routing        (separate session)
  #5 capability modeling
  #6 reasoning auto-selection

Group D: iterative, needs real usage feedback        (done)
  #7 judgment quality eval                           (done — 37 cases, 7 dimensions)
  #8 trusted-default posture                         (done — /surface hints, /doctor)
```

### 22.7 Maturity Snapshot

```text
Strong agent runtime foundation
  [################----] ~80%

Routing DECISION layer (judgment quality)
  [####################] 100%

Backend EXECUTION layer (accepted scope)
  [####################] 100%
```

### 22.8 Implemented Source Files

```text
Core routing spine:
  execution-surface.ts           routing decisions, three-tier cascade
  execution-surface-runtime.ts   surface refresh from live state
  semantic-capabilities.ts       capability IDs, MCP metadata reading
  routing-constraints.ts         task-text constraint extraction
  task-capability-context.ts     task-text code.exec activation
  runtime-mode.ts                RuntimeMode type, manual default

Reasoning selection:
  reasoning-selector.ts          per-turn model/provider auto-selection

Orchestration + provenance:
  agent-runner.ts                provenance emission, routing event wiring
  orchestrator.ts                capability_routed + reasoning_routed events

Provider tools:
  tool-capabilities.ts           native tool constants, web capability specs
  native-web-tools.ts            provider-native tool factory

Eval:
  routing-eval.ts                eval framework, 37 cases across 7 dimensions
  mcp/tools.ts                   MCP capability inspection and semantic routing
  mcp/sdk-client.ts              MCP SDK adapter preserving `_meta` metadata
  mcp/types.ts                   MCP tool `_meta` support in typed surface

Prompt + UI:
  sections.ts                    auto-mode prompt guidance
  ExecutionSurfaceOverlay.tsx    /surface inspector UI (with unlock hints)
  commands.ts                    /doctor health check command

Types:
  CapabilityFamilyId             "web" | "vision" | "code" | "structured" | "audio" | "computer"
  RoutedCapabilityId             SemanticCapabilityId alias
  SemanticCapabilityId           "web.search" | "web.read" | "vision.analyze"
                                   | "code.exec" | "structured.output"
                                   | "audio.analyze" | "computer.use"
  NativeProviderCapabilityAvailability  webSearch, webPageRead, remoteCodeExecution,
                                        audioAnalyze, computerUse
  ProviderCapability             generate | chat | embeddings | vision |
                                   tools | thinking | models.* |
                                   hosted.webSearch | hosted.codeExecution |
                                   hosted.computerUse | media.audioInput |
                                   structured.output | citations.grounding
  ModelCostTier                  "free" | "cheap" | "standard" | "premium"
```
