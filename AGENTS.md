# Agent Notes

# AGENTS.md

## Environment

This project is on Windows.

Use PowerShell commands only.
Do not use bash, sh, sed, awk, grep, cat, or Linux-style commands unless explicitly available.

Use:
- `Get-Content` instead of `cat`
- `Get-ChildItem` instead of `ls -R`
- `rg` for search if available
- if `rg` is not available, use `Get-ChildItem -Recurse -File | Select-String`
- `py -3` instead of `python`

 
- `where.exe` to check commands

Do not use `apply_patch`.
Edit files directly through Codex file editing/diff tools.

## Language

All source code and project documentation must be written exclusively in English.
This includes comments, identifiers, user-facing strings defined in source, Markdown, HTML, CSS comments, and test descriptions.
Russian may be used only in chat with the user, never in repository files.

## Project commands

Use only commands that exist in this repo.
Do not invent test/build commands.

If unsure, inspect `package.json`, `.csproj`, `.sln`, or README first.
## Event Bus Contract

Any object or class that accepts an `eventBus` must begin with a precise top-level description of its event contract.

This is mandatory.

The description must explicitly list:
- what events it accepts / subscribes to
- what events it emits / publishes

Do not omit this.
Do not replace it with vague prose.
When changing event-driven behavior, update this description in the same edit.
## Presenter Screen States

Any presenter that reacts to orchestration or event-bus activity should describe its screens or presenter-states at the top of the file.

This is strongly preferred and should be treated as the default architecture style.

The description should make clear:
- which screens/states the presenter has
- which events can move it from one screen/state to another
- which events it listens to while in those screens/states
- what it emits as user intent back into the bus

Implementation rule:
- a presenter should not blindly apply every incoming event to the UI
- it should first know which screen/state it is currently rendering
- then decide whether the incoming event is relevant to that screen/state

Diagnostics rule:
- presenter design should preserve the ability to debug bad UI output from:
  - the event log seen by the presenter
  - the presenter screen-state transition log
- the intended mental model is:
  current presenter screen/state + incoming event -> apply or ignore -> visual update

## `main.js` Is a Protected Architecture Showcase

### DO NOT REFACTOR `main.js`

The current `main.js` structure is explicitly approved. It is a deliberately designed architecture showcase, not ordinary implementation code and not an invitation for cleanup.

- Do not refactor, rewrite, simplify, modernize, reorganize, reformat, or optimize `main.js`.
- Do not change its imports, comments, naming, object grouping, construction order, startup-event order, or control flow as collateral work.
- Do not remove apparently unused runtime references. Their visibility is part of the architectural presentation.
- Do not replace the `app` runtime container, inline its properties, split it into helpers, or move its composition into bootstrap code.
- Do not add generic helpers, defensive wrappers, lifecycle boilerplate, abstractions, or error-handling code to `main.js`.
- Do not modify `main.js` merely to make another component, test, state machine, presenter, provider, or repository easier to implement.
- Treat any requested work outside `main.js` as an explicit prohibition on touching `main.js`.
- Change `main.js` only when the user explicitly identifies the exact `main.js` change they want.
- When such an exact change is requested, make only that change and preserve every unrelated part byte-for-byte where practical.

The unusual shape of `main.js` is intentional: a technical lead or hiring reviewer should understand the system architecture within the first 30 seconds. Code that may look redundant by normal implementation standards can be required presentation structure here.

`main.js` is the composition root and the project's 30-second architecture showcase for a technical lead or hiring reviewer.

A reader must be able to understand the application's major runtime objects, ownership boundaries, dependency wiring, and startup order immediately from this file.

### Change boundary

- Do not edit `main.js` unless the user explicitly asks for a `main.js` change.
- A task concerning a state-machine step, presenter, provider, repository, prompt, resource, or test does not authorize a `main.js` change.
- Do not silently include `main.js` in cleanup, refactoring, compatibility fixes, formatting, or integration work.
- Before an authorized `main.js` edit, explain the intended change and preserve its role as the architecture showcase.
- Do not rewrite `main.js` to fit incomplete or temporary component APIs. Implement or align the components around the architecture declared by `main.js`, step by step.

### What must remain visible

`main.js` must visibly retain named local references for the major runtime objects it creates, even when a reference is not yet used later in the file. These names are intentional architectural documentation.

This includes, as applicable:

- the shared event bus;
- the resource factory;
- the provider factory;
- the tree repository;
- the main presenter;
- the game presenter;
- the debug presenter;
- the bootstrap/core state machine.

Do not replace named declarations such as `const resourceFactory = ...` or `const mainPresenter = ...` with anonymous expressions such as `new ResourceFactory(...)`.

Presenter root IDs in `main.js` must use exported presenter constants; do not place DOM ID string literals in the composition root.

Group the long-lived runtime references in a named `app` object created before startup events are published. Include the event bus, factories, tree repository, presenters, and bootstrap state machine in that object; publish startup events through `app.eventBus` and run orchestration through `app.bootstrapStateMachine`.

### Deliberate architecture decisions

- `GlobalTracer` is not required in `main.js`.
- The selected LLM provider does not need to exist as a separately named runtime object in `main.js`.
- Provider selection is deliberately explicit through `eventBus.publish(EventIds.providerSelectRequested, DEFAULT_PROVIDER_TYPE)`. Keep a concise comment explaining that this line explicitly selects the default provider. Provider IDs are canonical values only: `local`, `echo`, or `openai`; do not introduce aliases.
- Initial resource loading must remain explicitly visible in `main.js` as `eventBus.publish(EventIds.appResourcesReadRequested, DEFAULT_LANGUAGE)`. Language values are canonical codes only: `en` or `de`; do not introduce language names or aliases.
- Initial tree reading does not belong in `main.js`. The game state machine owns reading and rereading the tree.
- It is acceptable for detailed orchestration to live inside the bootstrap state machine. `main.js` must still make the major composition objects and startup sequence visible.
- Create one long-lived `TreeRepository` as `app.treeRepository` in `main.js` before startup events. Its stable default storage key belongs inside `repository-tree.js`, not in `main.js`. State machines own when to read or write the tree and communicate with the repository only through tree events.

### Readability rules

- Do not put low-level UI error helpers such as `errorMessage()` or `setError()` in `main.js`.
- Do not add empty lifecycle methods such as `init() {}` or constructors that exist only to call an empty method.
- Avoid implementation noise that prevents a reviewer from seeing the architecture within the first 30 seconds.
- `main.js` should read as an intentional application blueprint, not as a utility module and not as a workaround for unfinished APIs.

### Incremental implementation rule

Comments stating that `main.js` is a declaration of architectural intent are protective requirements, not disposable commentary.

When the declared composition is not executable yet:

1. keep the architectural declaration intact;
2. implement the missing component or integration point outside `main.js`;
3. cover that component with tests;
4. make the declared startup sequence executable incrementally;
5. change `main.js` only when the user explicitly requests that step.
