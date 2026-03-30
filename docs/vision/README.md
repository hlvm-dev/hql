# HLVM Vision: The AI Capability Platform

**Status**: Vision / PMF Definition
**Date**: 2026-03-30
**Audience**: Contributors, GenAI agents, future collaborators

---

## Document Index

This directory contains the complete vision, design, and requirements for HLVM
as an AI capability platform. Each document is self-contained and reusable by
any human or AI reader.

| Document | Contents |
|----------|----------|
| [00-platform-thesis.md](./00-platform-thesis.md) | HLVM Platform Thesis: the "LLVM for LLM" analogy, architecture layers (moved from hlvm-platform/) |
| [01-story.md](./01-story.md) | The full story: why this exists, what it becomes, why it matters |
| [02-module-system.md](./02-module-system.md) | ESM modules as AI capabilities: architecture, authoring, composition |
| [03-module-store.md](./03-module-store.md) | The central registry: design, requirements, trust model, flywheel |
| [04-user-journeys.md](./04-user-journeys.md) | End-to-end flows for authors, consumers, and AI-authored modules |
| [05-competitive-analysis.md](./05-competitive-analysis.md) | Landscape analysis: what exists, what doesn't, where HLVM fits |

---

## The One-Sentence Vision

**HLVM is a platform where AI capabilities are authored in HQL, packaged as
ESM modules, shared through a central store, and executed with one click on
macOS.**

## The One-Paragraph Version

Every knowledge worker fights complexity daily: data analysis, report writing,
code review, research, monitoring. AI can handle most of this, but today the
gap between "AI can do this" and "I have an automated workflow" requires
learning Python, installing libraries, writing orchestration code, and running
from a terminal. HLVM collapses that gap. Write a 3-line HQL function (or have
AI write it for you), deploy it to the Module Store, and it becomes a clickable
icon on your Mac. Behind that icon can be anything: a simple AI call, a
multi-step pipeline, or a full autonomous agent team. One click. Job done.

## Key Architectural Relationship

```
~/dev/hql                        ~/dev/HLVM
(this project)                   (macOS app)

hlvm binary                      SwiftUI thin shell
  HQL compiler                     Spotlight panel
  Deno runtime                     Chat window
  Agent engine                     Hotbar (module icons)
  Team system                      Module Store view
  Module Store CLI                 Settings
  Memory system
  Tool registry

Code-first core ◄── HTTP localhost ──► Beautiful native GUI
ALL logic here                        ZERO logic here
```

The macOS app (`~/dev/HLVM`) is a thin SwiftUI client. The hlvm binary
(this project, `~/dev/hql`) is the core that does everything. The Module Store
follows this same pattern: CLI commands in the binary, beautiful GUI in the app.
