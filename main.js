import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { MainPresenter } from "./presenter-main.js";
import { GamePresenter } from "./presenter-game.js";
import { DebugPanelPresenter } from "./presenter-debug-panel.js";
import { ProviderFactory } from "./provider-factory.js";
import { TreeRepository } from "./repository-tree.js";
import { ResourceFactory } from "./resource-factory.js";
import { getCoreStateMachineDefinition } from "./state-machine-bootstrap.js";
import { StateMachine } from "./state-machine.js";

const STORAGE_KEY = "browser-llm-demo.tree";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function setError(message) {
  const statusElement = document.getElementById("status-text");
  if (!statusElement) {
    return;
  }

  statusElement.textContent = message;
  statusElement.classList.add("error");
}

// `main.js` is the composition root of the app:
// it wires together infrastructure, presenters, provider setup, and orchestration.
class Main {
  constructor() {
    this.init();
  }

  init() {}

  async execute() {
    // `main.js` currently acts more as a declaration of architectural intent
    // than as a fully working runtime composition root.
    // The plan is to make this file real step by step by finishing the missing
    // components, aligning integration points, and covering the flow with tests
    // until the declared bootstrap sequence becomes fully executable.
    // The event bus is the backbone of the runtime.
    // Most parts of the app communicate through events instead of direct calls.
    const eventBus = new EventMessageBus();

    // Factories centralize resource loading and provider selection.
    new ResourceFactory(eventBus);
    new ProviderFactory(eventBus);

    // Presenters start early so they can react to startup events as soon as they fire.
    new MainPresenter({ rootId: "app-root", eventBus });
    new GamePresenter({ rootId: "game-panel", eventBus });
    new DebugPanelPresenter({ rootId: "debug-panel", eventBus });

    // The repository is the persistence boundary for the learned animal tree.
    new TreeRepository({ eventBus, storageKey: STORAGE_KEY });

    // Bootstrap runtime dependencies before the orchestration layer starts.
    eventBus.publish(EventIds.providerSelectRequested, "local");

    // The core state machine owns the startup/game flow once bootstrapping is complete.
    const bootstrapStateMachine = new StateMachine(
      eventBus,
      (context) => getCoreStateMachineDefinition(context),
    );

    try {
      // Hand control over to the event-driven application flow.
      await bootstrapStateMachine.run();
    } catch (error) {
      // Surface bootstrap errors in the UI instead of failing silently.
      setError(errorMessage(error));
    }
  }
}

// Keep startup explicit so the file remains readable as an architectural script.
const m = new Main();
m.execute();
