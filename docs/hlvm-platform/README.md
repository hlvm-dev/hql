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

## 15. The Important `search_web` Clarification

This example is central because it illustrates both the progress already made
and the remaining gap.

### 15.1 What `search_web` gets right

HLVM already has:

- its own tool name
- its own arguments
- its own guidance
- its own fallback implementation

That means HLVM is not simply exposing raw vendor wire names to the model.

That is good.

### 15.2 What `search_web` does not yet solve

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

### 15.3 Why naming still matters

The difference between:

- `search_web`
- `web_search`
- `google_search`

does matter at the adapter layer.

It should not matter to the top-level runtime logic.

That is the distinction to preserve.

---

## 16. Where HLVM Is Today

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

### 16.1 What is already strong

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

### 16.2 What is still partial or shallow

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

### 16.3 What is still missing

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

## 17. What Should Be Preserved

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

## 18. What Should Be Re-Layered

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

## 19. What Must Remain True

- HLVM should not merely choose a model.
- HLVM should choose how the whole task gets executed.
- The higher abstraction is the destination.
- Manual model/provider choice remains a real first-class feature.
- During transition, manual choice may remain primary.
- The higher abstraction may remain opt-in until it is stable enough to trust.
- The user should eventually be able to speak mostly in task language.
- The system must respect privacy, locality, and user constraints.
- The same conceptual task should remain coherent across different backend sets.

---

## 20. Final Summary

HLVM should be treated as a runtime platform whose job is to execute user
intent across heterogeneous AI backends rather than as a mere adapter whose job
is to route prompts to many vendors. This does not eliminate the need for lower
layers such as provider adapters, local tools, or MCP connections. It elevates
them into inputs to a higher semantic execution layer. The current codebase
already contains meaningful foundations for that direction, which means the
vision is not fantasy. The architecture is not fundamentally wrong. It is
unfinished. The end-state remains a high-level task execution platform, while
the transitional product may still keep manual model/provider choice as the
primary path until the higher abstraction is stable enough to trust.
