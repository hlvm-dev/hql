# 06 — Beyond "LLVM for LLM"

**Status**: TODO / Next-Layer Vision
**Date**: 2026-03-31

---

## Purpose

This document clarifies an important distinction:

- the current HLVM "LLVM for LLM" milestone
- the broader future vision where HLVM compiles a user objective into an
  executable agent organization

Those are related, but they are not the same finish line.

For the completed current thesis, see:

- [`../llvm-for-llm/README.md`](../llvm-for-llm/README.md)

That document reflects the current completed milestone.

---

## The Key Clarification

Whether "LLVM for LLM" is already 100% complete depends on the definition.

### Definition A: Current Completed Meaning

If "LLVM for LLM" means:

```text
user intent
  -> semantic capability inference
  -> routing across provider-native / MCP / hlvm-local
  -> reasoning/model switching when needed
  -> execution with visible provenance
```

then HLVM is already complete for that milestone.

Under that meaning, the answer is:

```text
Yes. 100% complete.
```

That is the meaning captured in:

- [`../llvm-for-llm/README.md`](../llvm-for-llm/README.md)

### Definition B: Higher Future Meaning

If "LLVM for LLM" is stretched to mean:

```text
one user prompt
  -> create the right agents
  -> create the right team shape
  -> create the right delegation graph
  -> create the right communication protocol
  -> choose the right planning strategy
  -> choose the right algorithm / data structure / architecture
  -> supervise execution
  -> reorganize itself while running
```

then HLVM is not done.

Under that meaning, the answer is:

```text
No. Still a long way to go.
```

That broader vision is the subject of this document.

---

## The Real Distinction

The current system is primarily a:

```text
capability router
```

The future system would be a:

```text
mission compiler
```

That is a major abstraction jump.

Current question:

```text
"Which backend/tool/model should execute this capability?"
```

Future question:

```text
"What organizational + computational structure should exist
to solve this objective?"
```

---

## Before vs After vs Next

### Before HLVM

```text
user prompt
  -> manually choose provider/model/tool
  -> manually orchestrate steps
  -> manually recover from missing capability
```

### Current HLVM

```text
user prompt
  -> infer semantic capabilities
  -> choose provider-native / MCP / hlvm-local
  -> switch reasoning model/provider if required
  -> execute
  -> expose provenance
```

### Next HLVM

```text
user objective
  -> infer work graph
  -> infer team topology
  -> infer roles and delegation
  -> infer communication structure
  -> infer planning / architecture strategy
  -> compile executable organization
  -> run, supervise, repair, escalate
```

---

## The Next-Layer Thesis

HLVM should eventually become more than a capability-routing runtime.

It should become a system that can compile a high-level objective into:

- the right execution graph
- the right agents
- the right team formation
- the right message flow
- the right memory boundaries
- the right approval boundaries
- the right tool/backend/model usage
- the right architecture and implementation strategy

The user should increasingly be able to say:

```text
"Solve this class of problem."
```

instead of:

```text
"Use this model, this tool, this sequence, this architecture,
and this delegation pattern."
```

---

## Conceptual Stack

The clean way to understand the future stack is:

```text
Layer 1  Execution backends
         providers, MCP, local tools, local models

Layer 2  Capability routing
         web.search, code.exec, vision, audio, computer.use, structured.output

Layer 3  Reasoning/model routing
         pick or switch model/provider for the turn

Layer 4  Agent/team synthesis
         planner, workers, reviewer, manager, specialists

Layer 5  Mission compilation
         objective -> executable organization
```

Today HLVM has largely completed Layers 2 and 3.

The next vision is about Layers 4 and 5.

---

## What That Future System Would Need

To reach this next layer, HLVM would need first-class representations for:

### 1. Objective IR

A structured representation of:

- the goal
- constraints
- success criteria
- budget / latency / trust posture
- required artifacts
- approval requirements

### 2. Work Graph IR

A structured representation of:

- subtasks
- dependencies
- parallelizable work
- checkpoints
- merge points
- failure recovery paths

### 3. Organization IR

A structured representation of:

- roles
- responsibilities
- delegation boundaries
- reporting lines
- escalation paths
- review authority

### 4. Communication Protocols

The runtime should be able to choose patterns such as:

- single agent
- planner + worker
- manager + specialists
- executor + reviewer
- hierarchical tree
- market / bidding
- checkpointed batch execution

### 5. Strategy Synthesis

The runtime should be able to infer:

- algorithm family
- data structure choices
- architectural decomposition
- testing strategy
- rollout / hardening path

### 6. Supervisory Runtime

The system should be able to:

- monitor progress
- detect stalls
- reorganize teams
- retry with different topology
- ask for approval when thresholds are crossed

---

## What Makes This Different

This is not just "better multi-agent support."

It is a different unit of compilation.

Current unit:

```text
capability
```

Future unit:

```text
coordinated work system
```

That is why the current milestone can be honestly complete while the future
vision can still be far away.

Both statements can be true at the same time:

```text
Current LLVM-for-LLM milestone: 100% complete
Broader mission-compiler vision: still early
```

---

## Why This Matters

If HLVM stops at capability routing, it is already a strong and useful system.

But the larger opportunity is higher:

- not just "pick the right tool"
- but "create the right structure for solving the work"

That is the difference between:

```text
tool orchestration
```

and:

```text
objective compilation
```

---

## Practical Status

### What Is Already Done

Done now:

- semantic capability routing
- provider-native / MCP / hlvm-local cascade
- reasoning/model switching
- provenance and trust surface
- 7/7 executable capability coverage under the current thesis

See:

- [`../llvm-for-llm/README.md`](../llvm-for-llm/README.md)

### What Is Not Done Yet

Still future work:

- automatic team formation
- delegation graph synthesis
- role/topology compilation
- message protocol synthesis
- organization-level replanning
- architecture/algo/data-structure strategy synthesis as a first-class runtime responsibility

---

## The Correct Answer

If someone asks:

```text
"Is HLVM as LLVM-for-LLM done?"
```

the honest answer is:

```text
Under the current completed thesis: yes.
Under this broader next-layer vision: no.
```

That is not a contradiction.

It is simply a statement that the phrase "LLVM for LLM" can refer to either:

- the already-completed capability-routing platform
- or a much more ambitious future objective-compilation platform

This document treats the second meaning as the next major horizon.

