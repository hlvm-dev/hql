# HLVM Platform Thesis

Prepared: 2026-03-20

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

The core idea is:

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

### 16.2 What `search_web` does not yet solve

Today `search_web` is still primarily:

```text
one concrete HLVM tool
```

The larger target is:

```text
one semantic capability
  -> many possible realizations
```

Until the runtime can choose among:

- hosted vendor search
- MCP search
- HLVM `search_web`

the abstraction remains incomplete.

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

The current codebase is best described as:

```text
strong agent runtime
+ strong local tool plane
+ decent multi-provider model plumbing
- weak semantic capability routing
- weak hosted/local/MCP unification
```

Or, in one sentence:

```text
Today HLVM is a strong runtime with swappable brains.
It is not yet a full task-level execution platform.
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

#### C. The shared runtime normalizes tool transport, not full platform semantics

Relevant file:

- [src/hlvm/providers/sdk-runtime.ts](../../src/hlvm/providers/sdk-runtime.ts)

The current runtime converts HLVM tool definitions into SDK-native function
tools.

This means it already handles:

- transport normalization
- native tool-calling shape adaptation

But it does not yet represent:

- semantic capability families
- hosted vs local choice
- MCP vs vendor vs HLVM fallback choice

That is the gap between lower-layer normalization and higher-layer orchestration.

#### D. HLVM tool names are good, but not yet sufficient

`search_web` is a good HLVM-owned tool name.

But naming the HLVM tool `search_web` does not by itself create a full semantic
capability system.

It only means:

```text
HLVM has its own local/public search tool vocabulary
```

It does not yet mean:

```text
HLVM can choose among multiple implementations of the same semantic need
```

### 17.3 What is still missing

The platform still needs:

- a first-class semantic capability layer
- a backend-choice layer across local, hosted, and MCP paths
- a policy-aware execution layer
- a stronger availability and capability picture
- a cleaner separation between final semantics and concrete tool names

Without enough of that layer, the system tends to collapse into:

- vendor names
- model names
- tool transport details
- HLVM tool names treated as if they were final semantics

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

HLVM should be treated as a runtime platform whose job is to execute user
intent across heterogeneous AI backends rather than as a mere adapter whose job
is to route prompts to many vendors. This does not eliminate the need for lower
layers such as provider adapters, local tools, or MCP connections. It elevates
them into inputs to a higher semantic execution layer. The current codebase
already contains meaningful foundations for that direction, which means the
vision is not fantasy. The architecture is not fundamentally wrong. It is
unfinished. The end-state remains a high-level task execution platform, while
the transitional product may still keep manual model/provider choice as the
primary path until the higher abstraction is stable enough to trust. The route
to that end-state should be understood as a staircase of prerequisite layers,
not as one giant all-at-once transformation.
