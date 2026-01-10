!ultrathink

Explain this project in a visual ASCII way - simple yet explanatory and thorough:

## Requirements

Create ASCII diagrams that show:

1. **Project Architecture Overview**
   - High-level component relationships
   - Data flow between major parts
   - Entry points and outputs

2. **Directory Structure Map**
   - Key folders and their purposes
   - How files relate to each other

3. **Core Data Flow**
   - How data enters the system
   - How it gets transformed
   - Where it ends up

4. **Key Abstractions**
   - Main classes/modules and their roles
   - Interfaces between components

## ASCII Art Style Guide

```
Use boxes for components:
┌─────────────┐
│  Component  │
└─────────────┘

Use arrows for data flow:
──────►  (one direction)
◄──────► (bidirectional)

Use pipes for hierarchy:
├── child1
├── child2
└── child3

Use layers for architecture:
═══════════════════
   Layer Name
═══════════════════
```

Keep it readable - prefer clarity over comprehensive detail. If the project is complex, break into multiple focused diagrams rather than one overwhelming one.

## Arguments (optional)

You can specify:
- **Focus area**: `the REPL system` - explain only that subsystem
- **Depth level**: `high-level only` or `detailed` - control granularity
- **Specific aspect**: `data flow` or `module dependencies` - focus on one diagram type

Examples:
- `/jss-explain-visual` - full project overview
- `/jss-explain-visual src/parser/` - explain parser subsystem only
- `/jss-explain-visual focus on how evaluation works` - specific flow
- `/jss-explain-visual high-level architecture only` - just the big picture

$ARGUMENTS
