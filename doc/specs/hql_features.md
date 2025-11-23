HQL: Higher Quick Language

HQL aspires to be the last programming language by embracing the following core
principles: "macro everywhere, minimal-core, expression-oriented,
single-bundled-output, platform agnostic"

1. Minimal Core (Kernel) Philosophy: Your kernel should be the absolute minimal
   set of primitives that cannot be defined in terms of other constructs.
   Everything else is “sugar” built on top via macros. The kernel’s simplicity
   ensures that every expression returns a value (expression‑oriented) and is
   easy to reason about and port.

Core Components:

AST Types: Literal, Symbol, List: These three types form the backbone of your
language’s data. Every piece of code is represented as one of these, ensuring
homoiconicity. Essential Special Forms: Implement these directly in the
evaluator (or as built‑in primitives) because they cannot be defined using other
forms: quote: Prevents evaluation (returns the expression as data). if: A
conditional expression that always returns a value. fn: For both named and
anonymous function creation. let: For global bindings. Primitive Operations:
Provide a minimal set of built‑in operations (arithmetic, list operations,
equality) that macros and the evaluator can rely on. These primitives remain as
part of the core because they need to be efficient and are not easily defined in
terms of more basic constructs. Key Point: The core is minimal and “pure” — it
contains only what is absolutely necessary for evaluation and cannot be defined
in terms of other forms.

2. Macro System (“Macro Everywhere”) Philosophy: Every language construct (other
   than the minimal kernel) is defined via macros. This gives you tremendous
   power and flexibility: you can extend the language without modifying the
   core, and every high-level construct is an expression.

Steps to Build the Macro System:

macro: Create a special form that allows users to define new macros. This form
will capture a macro’s parameters and body and register it in a global macro
environment. Macro Expander: Write a function that recursively traverses your
AST. When it encounters a list whose first element corresponds to a macro
definition, it substitutes the macro’s parameters with the unevaluated arguments
and replaces that form with its expansion. Key Outcome: After expansion, the AST
consists entirely of core forms (quote, if, fn, def, etc.), ensuring every
construct is an expression. Hygiene Considerations: Aim for a system that
minimizes accidental variable capture. You can start simple, then add mechanisms
(like gensyms) to ensure macro hygiene. Outcome: You’ll be able to define
higher‑level constructs (like let, cond, print, and even JS interop forms)
purely as macros. This “macro everywhere” approach means your entire language
surface can be built on a tiny core.

3. Transpiler Pipeline Philosophy: The pipeline should take HQL source code and
   transform it through a series of well‑defined stages, with every stage
   operating on expressions and preserving uniformity. The final output is a
   single, self-contained JavaScript file.

Pipeline Stages:

Parsing: Convert the HQL source code into an AST using your minimal AST types
(literal, symbol, list). Macro Expansion: Run the macro expander over the AST.
Goal: Replace every macro invocation with its expansion so that only core
constructs remain. Result: An expanded AST composed solely of the minimal
kernel’s forms. Intermediate Representation (IR) Generation: Transform the
macro-expanded AST into an intermediate representation. Purpose: Normalize the
structure and prepare it for code generation. Note: The IR should still follow
the "everything is an expression" philosophy. ESTree AST
Conversion: Convert the IR into an ESTree AST that maps directly to JavaScript.
Aim: Preserve the expression-oriented nature while creating a
structure that your code generator can easily process. Code Generation: Generate
a JavaScript code string from the ESTree AST. Outcome: The code produced should
be a single self-contained file where every construct is an expression. Example:
All JS interop forms are inlined (e.g. using IIFEs to handle member access with
correct binding). Bundling: Inline all module dependencies and platform-specific
code so that the final output is one complete JS file with no external imports.
Integration: This stage uses your platform abstraction to resolve and inline any
dependencies. Outcome: The entire transpiler pipeline produces a single inline
JS file that is fully self-contained, expression‑oriented, and can run directly
on Deno.

4. Platform Abstraction Philosophy: While your immediate target is Deno, you
   want to design HQL in such a way that all platform-specific operations are
   isolated behind a clean interface. This makes the system more portable in the
   future.

Key Points:

Interface Definition: Define a platform interface that includes functions for
file I/O, module resolution, environment access, etc. Deno Implementation:
Provide a Deno-specific implementation (wrapping Deno’s APIs). Example: Instead
of calling Deno.readTextFile directly, use an abstraction function like
readTextFile(path). Non-Impact on Caller: The public API remains unchanged so
that all HQL caller code isn’t affected by the internal abstraction. Outcome:
Even though you’re currently tied to Deno, your core language and transpiler
pipeline are built in a platform-agnostic way, easing potential future
migration.

5. Step-by-Step Roadmap Define the Minimal Core: Create AST types for literals,
   symbols, and lists. Implement a minimal evaluator for core forms (quote, if,
   fn, def, fn). Build a standard environment with arithmetic, list operations,
   and equality primitives. Implement the Macro System: Implement macro to
   register macro definitions. Write a recursive macro expander that processes
   the AST and expands all macros into core forms. Refactor Built‑Ins as Macros:
   Gradually refactor high-level constructs (fn, import, export, print, etc.) so
   that they are defined as macros over the minimal kernel. Integrate the
   Transpiler Pipeline: Follow the clean transpiler pipeline with parsing, macro expansion, IR generation, ESTree AST generation, and code generation/bundling (detailed pipeline phases described in "Clean Transpiler Pipeline" section below). Testing and Iteration:
   Write tests at each stage (core evaluator, macro expander, IR transformation,
   code generation). Benchmark compile times and ensure every expression returns
   a value. Refine error messages and debugging facilities to handle macro
   expansion errors. Summary of Your Vision and Next Steps Vision: You want HQL
   to be a lean, expression‑oriented language where every construct is an
   expression. Nearly every high-level feature is implemented as a macro on top
   of a minimal kernel (inspired by Scheme) with a Clojure‑friendly syntax. The
   final output is a single, self-contained JavaScript file runnable on Deno,
   with a clear platform abstraction. Current State: You have a basic transpiler
   pipeline with built‑in forms and unified JS interop, but not yet a complete
   “macro everywhere” system or minimal core that distinguishes itself from
   higher-level sugar. Where to Go: Build the minimal core first, then implement
   the macro system, refactoring high-level constructs into macros. Integrate
   all of this into your transpiler pipeline so that after parsing and macro
   expansion, the IR is transformed into a final JavaScript AST and then into a
   self-contained JS file. Next Steps: Finalize the core AST and evaluator
   (ensuring everything is an expression). Implement and test a robust macro
   expander with macro. Refactor built‑ins (like fn, import, export) as macros.
   Integrate these stages into your transpiler pipeline and confirm that the
   final output is a single bundled JS file. Continue refining and testing until
   the system is stable. This roadmap emphasizes a clear separation between a
   minimal, self-contained kernel and a flexible, macro-based surface language,
   all integrated into a clean transpiler pipeline. It honors your design
   philosophy of "everything is an expression" and aims to produce a final,
   self-contained JS file for Deno.

Does this detailed, step-by-step plan capture everything you envision and
clarify what needs to be done next?

You said: add expression everywhere as well Reasoned for a couple of seconds
Below is an updated, comprehensive summary and step-by-step roadmap that
emphasizes your design philosophy of “everything is an expression” along with
the “macro everywhere” approach and a clean, self-contained transpiler pipeline
targeting Deno.

Your Vision for HQL

Minimal Core (Kernel): Expression-Oriented: Every construct in the language is
an expression that returns a value. Even control forms like conditionals,
bindings, and function definitions yield a value. Essential Primitives Only: AST
Types: Basic nodes for literals, symbols, and lists. Core Evaluation Forms:
quote: Returns its argument without evaluation. if: Evaluates a condition and
then returns one branch or the other. fn: Creates both named and anonymous
functions that always return the value of their last expression. let: Bind names
to values in the environment. Basic Operations: A minimal set of arithmetic,
list operations, and equality primitives that serve as the foundation for macro
expansion and further language constructs. Macro Everywhere: Core Built as
Primitives: The kernel contains only the non‑derivable, essential forms.
Higher‑Level Constructs as Macros: Every other feature—such as fn (which can be
defined in terms of let and fn), import, export, print, and even control
structures like let or cond—is defined as a macro that expands into the minimal
core forms. Uniformity: Since macros expand into expressions, every language
construct remains expression‑oriented. This gives you a consistent and uniform
syntax that is easy to reason about and extend. Unified JavaScript Interop:
Composite Member Access: You want to support natural expressions like
(obj.member) which at runtime check if member is callable and, if so, invoke it
with the proper binding. Example: (let upper (message.toUpperCase)) expands to
an expression that returns the result of calling toUpperCase on message (if it’s
a function) or its property value otherwise. Self-Contained Output: Transpiler
Pipeline: The pipeline must parse HQL source, expand macros, transform the AST
to an intermediate representation, convert that IR into an ESTree (JavaScript)
AST, and finally generate code—all while preserving the “everything is an
expression” property. Bundling: All modules and dependencies are inlined so that
the final output is a single, self-contained JavaScript file that runs on Deno
without any external attachments. Platform Abstraction: Decoupling from Deno:
Although your initial implementation targets Deno, platform-specific operations
(file I/O, module resolution, etc.) are abstracted behind an interface. This
keeps your core and transpiler pipeline independent of the host environment,
even if in the near term you only target Deno. Where You Are Now

Unified JS Interop Achieved: Your transpiler already transforms expressions like
(message.toUpperCase) into an IIFE that checks and calls the member with the
correct this binding. Basic Evaluator and Built‑Ins: You have a working
evaluator that implements constructs like def, fn, and basic arithmetic directly
in the evaluator. However, these built‑ins are not yet implemented as macros
over a minimal core. Platform Abstraction in Place: You have a platform
abstraction layer that currently wraps Deno’s APIs, ensuring that the caller’s
API remains unchanged. Where You Want to Go

Everything is Lazy evaluation:

Everything is an Expression: Every language construct, from control forms to
bindings, returns a value. This uniformity is critical for enabling advanced
macro expansion and for reasoning about code. Macro Everywhere: Redefine
high‑level constructs (fn, import, export, printing, even JS interop if desired)
as macros over the minimal kernel. Eventually, the entire surface language will
be built by macros that expand into a tiny core consisting of only the essential
primitives. Clean Transpiler Pipeline: Your pipeline should be well‑structured
into distinct phases: Parsing: Convert HQL source into an AST (literals,
symbols, lists). Macro Expansion: Recursively expand all macro invocations so
that the final AST consists only of core forms. IR Generation: Transform the
expanded AST into a normalized intermediate representation that preserves the
expression-oriented nature. ESTree AST Generation: Convert the IR into a
standards-compliant ESTree (JavaScript) AST. Code Generation and Bundling:
Generate a single, self-contained JS file from ESTree, inlining all modules so
no external dependencies remain. Platform-Agnostic Core: Although initially
targeting Deno, your design will allow future migration to other platforms
through the platform abstraction layer.

Step-by-Step Action Plan

Step 1: Define the Minimal Core (Kernel) AST Types: Create data types for
literals, symbols, and lists. Core Evaluator: Write a minimal evaluator that
handles: quote: (quote exp) returns the expression unevaluated. if: (if cond
then else) returns a value based on the condition. fn: (fn [params] body...)
returns an anonymous function, or (fn name [params] body...) defines a named
function, where the last expression in the body is automatically returned. let:
(let name value) binds a value globally. Primitive Functions: Provide basic
operations (arithmetic, list manipulation, equality). Example (simplified
pseudocode):

;; AST: literal, symbol, list ;; Evaluator: every expression returns a value ;;
Core built-ins: quote, if, fn, def, fn, +, -, *, /, cons, car, cdr, eq? Step 2:
Implement the Macro System macro: Define a special form that lets you write
macros, e.g.: (macro macro [name params & body] ;; Register macro definition in
the macro environment ) Macro Expander: Create a function that walks the AST and
replaces macro invocations with their expansions. Ensure that after expansion,
only core forms remain. Expression Everywhere: Guarantee that macro expansion
preserves the property that every form yields a value. Step 3: Refactor
Built‑Ins as Macros High‑Level Constructs: Gradually convert your built‑in forms
like import and export into macros that expand into core forms. JS Interop: If
desired, also wrap interop forms as macros to provide uniform expression
behavior. Step 4: Integrate the Transpiler Pipeline Parsing: Write a parser that
converts HQL source code into an AST. Macro Expansion: Apply your macro expander
to the AST so that all macros are expanded into core forms. IR Generation & AST
Conversion: Transform the macro-expanded AST into an intermediate
representation, then convert that into an ESTree (JavaScript AST). Code
Generation: Generate a self-contained JavaScript code string where every
construct is an expression. Bundling: Inline all module dependencies so that the
final output is one JS file. Step 5: Platform Abstraction Interface &
Implementation: Use your existing platform abstraction to ensure that operations
like file I/O, module resolution, and environment access are abstracted away.
This guarantees that the final code is self-contained and not littered with
external imports. Step 6: Testing and Iteration Write Tests: Create unit tests
for the evaluator, macro expander, IR transformation, and code generator. Refine
Error Messages: Ensure that errors after macro expansion (which can be difficult
to trace) are as clear as possible. Benchmark and Optimize: Verify that the
heavy macro expansion doesn’t cause unacceptable compile-time overhead. Summary

Past: You started with a transpiler that directly implemented built‑in forms and
JS interop, tied to Deno, but without a truly minimal core or a “macro
everywhere” approach. Now: You have unified JS interop, a basic evaluator, and a
platform abstraction. However, your built‑ins are still directly implemented,
not as macros. Goal: You want to refactor HQL so that everything outside of a
tiny, minimal kernel (consisting of only essential forms like quote, if, fn,
def, and basic primitives) is defined via macros. This gives you a uniform,
expression‑oriented language that produces a single, self-contained JS output.
The transpiler pipeline will be structured into: Parsing → Macro Expansion
(yielding only core forms) → IR Generation → ESTree AST Generation → Code
Generation → Bundling (with a platform abstraction for Deno). Philosophy: The
design is inspired by Scheme’s minimal kernel and Clojure’s friendly,
expression‑oriented syntax. Everything is an expression, and nearly every
feature is implemented as a macro over a tiny core. This ensures that the
language is both minimal and extremely extensible while producing self-contained
output. This roadmap outlines every detail of your vision—from the minimal core
and macro system to the complete transpiler pipeline and platform
abstraction—all while ensuring that every construct is an expression and that
the final output is a single bundled JS file for Deno.

Does this detailed, step-by-step plan capture your vision and provide clear
guidance for the next steps?

You said: pipeline is HQL raw code -> HQL AST -> HQL IR -> ESTree AST ->
JavaScript code

and insert macro expansion at the right place Reasoned for a few seconds Here's
an overview of the complete pipeline with macro expansion inserted at the proper
stage:

The Transpiler Pipeline HQL Raw Code → HQL AST Parsing: The raw HQL source is
parsed into an abstract syntax tree (AST) composed of basic nodes: Literals
(numbers, strings, booleans, nil) Symbols (identifiers) Lists (S‑expressions)
Example: HQL source:

(let greeting "Hello, HQL!") might parse into an AST like:

{ "type": "list", "elements": [ { "type": "symbol", "name": "def" }, { "type":
"symbol", "name": "greeting" }, { "type": "literal", "value": "Hello, HQL!" } ]
} HQL AST → Macro-Expanded HQL AST Macro Expansion: A macro expander walks the
AST recursively. It looks for lists where the first element is a macro (as
defined via macro) and expands them. After expansion, the AST consists solely of
core constructs (like quote, if, fn, let, etc.), ensuring everything is an
expression. Example: A user-defined macro like `when` might expand into an `if`
form:

(when condition action) After macro expansion, it becomes:

(if condition action nil) In the AST, the macro-expander replaces the high-level
macro form with the corresponding core expression. Macro-Expanded HQL AST → HQL
IR IR Generation: The macro-expanded AST is transformed into an intermediate
representation (IR) that normalizes the structure of the program. The IR uses a
small set of node types corresponding to the minimal core forms. This IR
simplifies subsequent conversion to the target language. Conceptually: The IR
might explicitly represent function definitions, variable bindings, and
conditional expressions in a uniform, low-level way. HQL IR → ESTree AST
Conversion: The IR is then converted into an ESTree AST (standard JavaScript AST). This
phase maps each minimal core construct into an equivalent ESTree node. Since every
HQL form is an expression, the ESTree AST reflects that by producing expression
nodes, function expressions, etc. ESTree AST → JavaScript Code (Final JS
Code) Code Generation: The ESTree AST is finally transformed into a raw code string.
The generated code is self-contained, fully inlined, and expression-oriented. It
is then bundled so that no external module references remain. Result: A single
JavaScript file that you can execute on Deno. Putting It All Together The
overall pipeline looks like this:

(new)

HQL Transpiler Pipeline (new) ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
┌────────┐ ┌────────┐ ┌────────┐ │ HQL │→ │ S-expr │→ │ Macro │→ │ HQL │→ │ HQL
│→ │ ESTree │→ │JavaScript│ │ Source │ │ Parse │ │ Expand │ │ AST │ │ IR │ │ AST │ │
Output │ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
└────────┘

(legacy)

HQL raw code ↓ (Parsing) HQL AST ↓ (Macro Expansion) Macro-expanded HQL AST ↓
(IR Generation) HQL IR ↓ (ESTree AST Generation) ESTree (JavaScript AST) ↓ (Code Generation)
JavaScript code (Final bundled JS file)

At each stage, every construct is maintained as an expression. Macro expansion
is performed right after parsing so that higher‑level constructs (like fn,
import, export, JS interop forms) are transformed into the minimal core forms.
This guarantees uniformity and ensures that the final output is a fully
self-contained JS file ready for execution on Deno.
