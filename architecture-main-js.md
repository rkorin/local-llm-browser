# Main.js Architecture Intent

## Purpose

This document captures the intended architectural meaning of `main.js` before any further refactoring.

The goal is not merely to make `main.js` shorter or prettier. The goal is to make `main.js` the **composition root** and the **architectural map** of the application.

`main.js` should be readable as the place where a developer can understand:

- which major runtime objects exist;
- in which order they are created;
- how they communicate;
- which objects own persistence;
- which objects own UI rendering;
- which objects own orchestration;
- which objects are generic infrastructure versus application-specific behavior.

Nothing in the original design intent should be lost during refactoring. This file exists to preserve that intent.

## Core Idea

The application should be organized around a small set of explicit runtime objects wired together in `main.js`.

The central communication mechanism is an **event bus**.

Most subsystems should not call each other directly. Instead, they should:

- subscribe to bus events;
- react to those events;
- keep their own state when they are the real owner of that state;
- publish new events for the rest of the application.

This makes `main.js` more than a launcher. It becomes a deliberate declaration of the system structure.

## Main.js As Composition Root

`main.js` should visibly create and connect the following major objects in roughly this order:

1. `EventBus`
2. `GlobalTracer`
3. `MainPresenter`
4. `GamePresenter`
5. `ResourceFactory`
6. `ProviderFactory`
7. `Selected LLM Provider`
8. `DebugPanelPresenter`
9. `CoreStateMachine`

Each of these objects should be visible in `main.js` because each represents a major architectural concept.

The top-level file should read like an application blueprint, not like a hidden bootstrap delegating everything into a giant helper module.

## Ownership And Source Of Truth

After refinement, the architecture intentionally rejects a shared application-wide storage object.

The main architectural question is:

- if there is no shared global storage, who owns the current state?

The answer should be explicit and local.

### Resources

Source of truth:

- `ResourceFactory`
- or the resolved resource object produced by it and passed explicitly as a dependency

Meaning:

- resources should be resolved by the resource layer;
- objects that need resources should receive them through construction or explicit updates;
- resources should not be hidden inside a generic shared store.

### Game Chat

Source of truth:

- `GameStateMachine`
- or a dedicated game runtime object if one is introduced later

Meaning:

- chat belongs to the game flow;
- it should live in the game runtime state;
- UI should receive chat updates through events;
- chat does not need to be held in a separate app-wide storage object.

### Tree

Source of truth:

- in-memory game state owned by the game flow
- `TreeRepository` as the persistence boundary

Meaning:

- the game flow owns the currently active tree state;
- persistence is delegated to the repository;
- loading and saving are explicit operations rather than hidden shared-state behavior.

### Provider State

Source of truth:

- the provider itself
- its lifecycle events

Meaning:

- readiness, progress, and failures belong to the provider layer;
- UI and orchestration learn about provider state through events;
- provider state should not be mirrored into a generic shared store unless there is a very strong reason.

## Runtime Object Responsibilities

### EventBus

The event bus is the central transport mechanism.

Responsibilities:

- allow any runtime object to subscribe to application events;
- allow any runtime object to publish application events;
- decouple UI, orchestration, provider logic, persistence, and tracing;
- act as the shared communication channel for the whole application.

Architectural rule:

- the event bus is the backbone of the app;
- cross-component communication should prefer events over direct object-to-object calls.

### GlobalTracer

The tracer is a cross-cutting observer of the entire runtime.

Responsibilities:

- subscribe to bus events;
- record them internally;
- preserve event history for debugging and diagnostics;
- later support multiple output targets.

Future extensions explicitly intended:

- log to console;
- log to file;
- send logs to a server;
- show logs in a separate debug window or panel opened from the UI.

Architectural rule:

- the tracer should observe the system, not control it.

### MainPresenter

The main presenter is responsible for the main application shell or top-level UI area.

Responsibilities:

- subscribe to bus events related to resource availability;
- subscribe to provider loading and provider status events;
- subscribe to state machine events;
- update UI according to current application state.

The original intent specifically expects this presenter to react to events such as:

- resources loaded;
- provider loaded;
- provider initialization progress;
- state machine state changes or transitions.

Architectural rule:

- presenters render and emit user intent;
- they should not own orchestration logic.

### TreeRepository

The tree repository is the persistence boundary for the animal question tree.

Responsibilities:

- load the tree from `localStorage`;
- save the tree to `localStorage`;
- isolate storage format from the rest of the app.

Architectural rule:

- persistence logic should live behind repository abstractions, even if the backing store is only `localStorage` for now.

### GamePresenter

The game presenter owns the visible game panel.

Responsibilities:

- subscribe to resource events;
- subscribe to game-related state machine events;
- render the correct panel depending on the current flow state;
- react to chat update events emitted by the game flow;
- emit user actions back into the event bus.

Examples of user actions it may emit:

- user agreed to start the game;
- user selected Yes;
- user selected No;
- user submitted an animal name;
- user requested a new game.

Architectural rule:

- the presenter should react to orchestration events;
- the presenter should not contain the game orchestration itself.

### ResourceFactory

The resource factory resolves the currently active localization resources.

Responsibilities:

- resolve the initial language resources;
- subscribe to language-switch events;
- reload resources when the language changes;
- emit a resources-loaded event into the bus;
- provide resolved resources explicitly to objects that need them.

Important persistence rule:

- resources are runtime objects;
- resources should not be persisted into `localStorage`.

Architectural rule:

- resources should be explicit dependencies, not globally mutable shared state.

### ProviderFactory

The provider factory selects which LLM provider implementation should be active.

Responsibilities:

- resolve the configured provider type;
- create the correct provider instance;
- support switching implementation without rewriting the rest of the app.

Intended provider classes include:

- local LLM provider;
- OpenAI-compatible API provider.

### LLM Provider

The selected LLM provider should behave like an event-driven service rather than a directly invoked singleton.

Responsibilities:

- subscribe to `llm-request` events;
- execute the appropriate provider operation;
- publish `llm-response` events;
- publish initialization progress events;
- publish readiness or failure events when useful.

Architectural rule:

- the rest of the app should talk to the provider through bus contracts, not by calling provider methods directly wherever convenient.

This is an important design statement:

- no implicit global provider object should become the true integration hub;
- the bus should remain the integration hub.

### DebugPanelPresenter

The debug presenter owns the debug panel.

Responsibilities:

- display traces;
- display the latest LLM request and response;
- allow manual debug interactions;
- possibly send direct `llm-request` events;
- receive `llm-response` events;
- render debug-oriented information without forcing it through the core state machine.

Important architectural rule:

- debug prompt replay is not a core business state;
- it is a debug-side interaction and should remain outside the main orchestration flow.

## Intended Startup Sequence

The intended startup sequence in `main.js` is conceptually:

1. Create the event bus.
2. Create and initialize the global tracer.
3. Create and initialize the main presenter.
4. Create and initialize the game presenter.
5. Create the resource factory and resolve resources.
6. Create the provider factory, select the provider, and initialize it.
7. Create and initialize the debug presenter.
8. Create the core state machine.
9. Start the core state machine.

This order matters because it reflects dependencies and visibility:

- the bus must exist before most other objects;
- the tracer should observe as much of startup as possible;
- presenters should be available before orchestration begins;
- resources and provider state should exist before the core flow depends on them.

## Dependency Passing Strategy

Because there is no shared application-wide storage object, dependencies should be passed explicitly.

Examples:

- presenters may receive resources through constructor injection or explicit update methods;
- state machines may receive repositories, resource accessors, and helper services directly;
- factories may push updates through events rather than through a shared mutable store.

Architectural rule:

- prefer explicit ownership and explicit dependency passing over indirect shared global state.

## State Machine Design Intent

There are two distinct orchestration machines:

- a **core state machine**;
- a **game state machine**.

The core machine orchestrates the whole app flow.

The game machine orchestrates a single round or cycle of the guessing game.

## Base StateMachine Responsibilities

The base state machine is meant to be a reusable, generic infrastructure component.

It should support:

- running from a start node;
- moving between nodes through explicit transition keys;
- publishing transition events to the event bus;
- waiting for external events from the bus;
- possibly providing a generic LLM request helper built on top of the event bus;
- exposing enough runtime state that external tools can inspect or control it.

The original intent explicitly expects functionality like:

- `waitForEvent("some-event-id")`
- `waitForAnyEvent([...])`
- a generic `fetchLlm` or `requestLlm` helper owned by the base class rather than duplicated across business flows.

Architectural rule:

- the base machine should know about orchestration mechanics;
- it should not know about resources, presenters, or provider-specific details.

## Core State Machine Intent

The core machine is the application-level orchestrator.

It should:

- publish transition events automatically;
- subscribe to the event bus as needed for control;
- stay ignorant of UI implementation details;
- stay ignorant of provider implementation details;
- stay ignorant of resource-loading internals except through generic readiness events.

### Intended Core Machine States

The comments imply an intended flow similar to this:

1. `wait-until-app-ready`
2. `verify-provider`
3. `ask-user-about-start-game`
4. `launch-game-machine`
5. `game-finished`
6. loop back to `ask-user-about-start-game` or directly to `launch-game-machine`

### `wait-until-app-ready`

The current placeholder name `apply-static-resources` was explicitly identified as semantically wrong.

The intended meaning is not "apply resources".

The intended meaning is:

- wait until resources are loaded;
- wait until the LLM provider is initialized;
- possibly wait for a single custom bootstrap-ready event that means startup dependencies are ready.

So this state is really a readiness barrier, not a UI application step.

### `verify-provider`

This step verifies that the provider is operational.

Expected behavior:

- send a test `llm-request`;
- wait for the provider response;
- decide whether the application can continue.

Important design point:

- the state machine should not need to know the concrete provider API;
- it should use generic bus-based LLM request behavior, ideally through a base-class helper.

### `ask-user-about-start-game`

This is an important intended step that is currently conceptual rather than fully implemented.

Expected behavior:

- entering the state emits a transition event;
- `GamePresenter` reacts to that event and shows a "Do you want to start the game?" panel;
- the presenter emits a user intent event such as `start-game-requested`;
- the state machine waits for that event before proceeding.

This is a key architectural pattern in the design:

- orchestration emits a state transition;
- UI reacts passively;
- user intent comes back as an event;
- orchestration resumes.

### `launch-game-machine`

This step creates and runs a new game state machine instance.

The original intent is explicit that the game machine is a true nested state machine:

- physically create a new state machine object;
- pass in the event bus;
- pass in explicit dependencies such as repository and resolved resources access;
- let it orchestrate the game flow independently.

### `game-finished`

This step marks the end of one completed game flow.

Expected behavior:

- emit an event that the game finished;
- let presenters react by showing results and a "Start New Game" button;
- either wait for the user to request a new game;
- or transition back to the "ask user to start" state.

The core machine should not terminate permanently after a single finished game unless that is a deliberate app-level decision.

## Game State Machine Intent

The game machine owns the actual question/answer flow of the animal guessing game.

Expected responsibilities:

- traverse the current tree;
- ask yes/no questions;
- wait for user choice events;
- request animal input when needed;
- update the tree when the system learns a new animal;
- keep its own chat state as machine state;
- emit chat update events so the presenter can re-render;
- load the initial tree through `TreeRepository`;
- save updated tree state through `TreeRepository`;
- end with meaningful results such as won, lost, cancelled, or invalid.

Architectural rule:

- the game machine is business orchestration;
- it should not become the UI implementation itself.

## Debug Flow Intent

Debug prompt replay is intentionally **not** a core machine state.

The intended debug interaction is:

- `DebugPanelPresenter` emits `llm-request`;
- the provider handles it;
- the presenter receives `llm-response`;
- the tracer preserves the latest relevant debug information.

This keeps debug interactions orthogonal to the main business flow.

## Event Contract Principles

The architecture requires explicit event contracts.

At minimum, the event system should cover these categories:

- resource events;
- provider lifecycle events;
- provider request and response events;
- state machine lifecycle and transition events;
- game lifecycle events;
- user intent events;
- chat update events;
- debug events.

The exact constant names can change, but the contract categories and responsibilities should remain.

## Event Catalog

This section lists the events implied by the design, along with potential senders and listeners.

The names below are architectural names rather than final mandatory constant names.

### Resource Events

#### `resources-load-requested`

Potential senders:

- `main.js` during startup;
- `ResourceFactory` internal bootstrap flow.

Potential listeners:

- `ResourceFactory`

#### `resources-loaded`

Potential senders:

- `ResourceFactory`

Potential listeners:

- `MainPresenter`
- `GamePresenter`
- `DebugPanelPresenter`
- `CoreStateMachine`

Payload intent:

- resolved resources object

#### `language-change-requested`

Potential senders:

- `MainPresenter`
- any language-switch UI

Potential listeners:

- `ResourceFactory`

Payload intent:

- next locale identifier

### Provider Lifecycle Events

#### `provider-initialize-requested`

Potential senders:

- `main.js` during startup;
- startup bootstrap logic

Potential listeners:

- selected LLM provider

#### `provider-initializing`

Potential senders:

- selected LLM provider

Potential listeners:

- `MainPresenter`
- `DebugPanelPresenter`
- `CoreStateMachine`

#### `provider-progress`

Potential senders:

- selected LLM provider

Potential listeners:

- `MainPresenter`
- `DebugPanelPresenter`

Payload intent:

- progress percentage or progress text

#### `provider-ready`

Potential senders:

- selected LLM provider

Potential listeners:

- `MainPresenter`
- `CoreStateMachine`
- `DebugPanelPresenter`

#### `provider-failed`

Potential senders:

- selected LLM provider

Potential listeners:

- `MainPresenter`
- `CoreStateMachine`
- `DebugPanelPresenter`

Payload intent:

- error details

### Generic LLM Request Events

#### `llm-request`

Potential senders:

- `CoreStateMachine`
- `GameStateMachine` through base helper methods
- `DebugPanelPresenter`

Potential listeners:

- selected LLM provider
- `GlobalTracer`

Payload intent:

- prompt
- request purpose
- correlation id

#### `llm-response`

Potential senders:

- selected LLM provider

Potential listeners:

- requesting state machine
- `DebugPanelPresenter`
- `GlobalTracer`

Payload intent:

- correlation id
- response text
- status

#### `llm-error`

Potential senders:

- selected LLM provider

Potential listeners:

- requesting state machine
- `DebugPanelPresenter`
- `MainPresenter`
- `GlobalTracer`

Payload intent:

- correlation id
- error details

### State Machine Lifecycle Events

#### `state-machine-started`

Potential senders:

- `StateMachine` base class

Potential listeners:

- `GlobalTracer`
- presenters
- debug tools

Payload intent:

- machine id
- start node id

#### `state-machine-transitioned`

Potential senders:

- `StateMachine` base class

Potential listeners:

- `MainPresenter`
- `GamePresenter`
- `DebugPanelPresenter`
- `GlobalTracer`

Payload intent:

- machine id
- previous node id
- next node id
- transition key

#### `state-machine-finished`

Potential senders:

- `StateMachine` base class

Potential listeners:

- `MainPresenter`
- `GamePresenter`
- `DebugPanelPresenter`
- `GlobalTracer`

Payload intent:

- machine id
- final status

### Core Machine UI Flow Events

#### `start-game-requested`

Potential senders:

- `GamePresenter`

Potential listeners:

- `CoreStateMachine`

Meaning:

- the user accepted the invitation to start the game

#### `start-new-game-requested`

Potential senders:

- `GamePresenter`

Potential listeners:

- `CoreStateMachine`

Meaning:

- the user wants another game cycle after completion

#### `game-finished`

Potential senders:

- `CoreStateMachine`
- or `GameStateMachine` if that boundary is preferred

Potential listeners:

- `GamePresenter`
- `MainPresenter`
- `DebugPanelPresenter`
- `GlobalTracer`

Meaning:

- a game session finished with a final outcome

### Game Interaction Events

#### `game-choice-yes`

Potential senders:

- `GamePresenter`

Potential listeners:

- `GameStateMachine`

#### `game-choice-no`

Potential senders:

- `GamePresenter`

Potential listeners:

- `GameStateMachine`

#### `game-animal-submit`

Potential senders:

- `GamePresenter`

Potential listeners:

- `GameStateMachine`

Payload intent:

- raw animal input string

#### `game-cancel`

Potential senders:

- `GamePresenter`
- `CoreStateMachine`

Potential listeners:

- `GameStateMachine`

### Chat State Events

#### `game-chat-updated`

Potential senders:

- `GameStateMachine`
- or a dedicated game runtime object

Potential listeners:

- `GamePresenter`
- `GlobalTracer`

Payload intent:

- the complete current chat state or an explicit append instruction

#### `game-chat-cleared`

Potential senders:

- `GameStateMachine`
- or a dedicated game runtime object

Potential listeners:

- `GamePresenter`
- `GlobalTracer`

### Debug Events

#### `debug-panel-open-requested`

Potential senders:

- `MainPresenter`
- debug UI controls

Potential listeners:

- `DebugPanelPresenter`

#### `debug-llm-requested`

Potential senders:

- `DebugPanelPresenter`

Potential listeners:

- selected LLM provider

This event may remain equivalent to `llm-request` rather than becoming a separate final event type. The important architectural point is that debug prompt replay is not a core machine state.

## What Must Not Be Lost During Refactoring

The following ideas are essential and should survive any rewrite:

- `main.js` is a structural architecture file, not a thin boot wrapper.
- the event bus is the central integration backbone.
- the tracer is a first-class cross-cutting runtime object.
- there is no shared application-wide storage object in the architecture.
- ownership must be explicit and local.
- resources are resolved through a dedicated factory and passed explicitly.
- chat belongs to the game flow and is emitted through events.
- the tree belongs to the game flow and persists through `TreeRepository`.
- providers are selected through a factory and integrated through events.
- provider progress and readiness should be observable.
- the core state machine is generic orchestration, not a place for UI or provider internals.
- the base state machine must know how to wait for events.
- the base state machine should probably know how to request LLM work generically.
- the game machine is a nested machine, not just a function call sequence.
- debug prompt replay is not a core machine state.
- game completion should drive another user-facing flow rather than being silently swallowed.

## Pending Clarification

A third refinement item was started in discussion but not completed.

That point should be added later rather than guessed here.

## Professional Architect Commentary

From an architectural perspective, the design intent is strong in several ways.

### What Is Strong

- It clearly separates **composition**, **presentation**, **provider integration**, **persistence**, and **orchestration**.
- It pushes the system toward **event-driven decoupling** instead of hidden direct dependencies.
- It treats the state machine as a reusable orchestration mechanism rather than an ad hoc control flow.
- It recognizes the difference between **business flow** and **debug flow**.
- It removes the risk of turning a shared global store into a god object.
- It naturally supports future growth such as:
  - alternative providers;
  - additional presenters;
  - more debug tooling;
  - new persistence backends;
  - more educational design-pattern examples.

### What Needs Discipline

- Event-driven systems become messy if event contracts are informal.
- Removing shared storage means ownership boundaries must stay very explicit.
- Nested state machines are powerful, but only if lifecycle boundaries are explicit.
- Too much logic inside `main.js` would be bad, but hiding too much in bootstrap helpers is also bad.

This means the right balance is:

- `main.js` should show the architecture;
- detailed logic should live in dedicated runtime classes;
- but `main.js` should still visibly instantiate the major runtime pieces.

### Main Architectural Risk

The biggest risk is ending up with **two hidden centers**:

- a fake event-driven architecture at the surface;
- but a real architecture underneath that still depends on direct calls and module-level mutable state.

That is the main thing the refactor should avoid.

### Recommended Guardrails

- define event contracts explicitly;
- keep ownership local to the real domain owner;
- avoid introducing a hidden shared state bag again under another name;
- avoid letting presenters own orchestration;
- avoid letting bootstrap files become the permanent home of domain logic;
- keep the provider interaction contract generic;
- keep state machine nodes semantically named after what they actually do.

## Suggested Refactoring Outcome

After the rewrite, `main.js` should ideally feel like a documentable architectural script that says:

- create infrastructure;
- create observers;
- create presenters;
- create factories;
- create provider;
- create orchestrators;
- start the app.

If that story is readable directly from `main.js`, then the refactor is preserving the original design intent correctly.

