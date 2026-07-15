import { EventIds } from "./event-ids.js";
import {
  startEventBus,
  initCorePresentationLayer,
  initGamePresentationLayer,
  initDebugPresentationLayer,
  initializeLLMProvider,
  initCoreStateMachine,
  startCoreStateMachine,
} from "./main.bootstrap.js";


// `main.js` is the composition root of the app:
// it wires together infrastructure, presenters, provider setup, and orchestration.
class Main {
  constructor() {
    this.init();
  }

  async execute() {
    // `main.js` currently acts more as a declaration of architectural intent
    // than as a fully working runtime composition root.
    // The plan is to make this file real step by step by finishing the missing
    // components, aligning integration points, and covering the flow with tests
    // until the declared bootstrap sequence becomes fully executable.
    // The event bus is the backbone of the runtime.
    // Most parts of the app communicate through events instead of direct calls.
    const eventBus = new EventBus();

    // Factories centralize resource loading and provider selection.
    const resourceFactory = new ResourceFactory(eventBus);
    const providerFactory = new ProviderFactory(eventBus);

    // Presenters start early so they can react to startup events as soon as they fire.
    const mainPresenter = new MainPresenter({ rootId: "app-root", eventBus, resourceFactory });
    const gamePresenter = new GamePresenter({ rootId: "game-panel", eventBus, resourceFactory });
    const debugPanelPresenter = new DebugPanelPresenter({ rootId: "debug-panel", eventBus, resourceFactory });

    // The repository is the persistence boundary for the learned animal tree.
    const treeRepository = new TreeRepository({ eventBus, storageKey: STORAGE_KEY });

    // Bootstrap runtime dependencies before the orchestration layer starts.
    eventBus.publish(EventIds.appResourcesReadRequested, "english");
    eventBus.publish(EventIds.providerSelectRequested, "local");
    eventBus.publish(EventIds.treeRootReadRequested, null);

    // The core state machine owns the startup/game flow once bootstrapping is complete.
    const context = {};
    const bootstrapStateMachine = new StateMachine(
      eventBus, resourceFactory,
      get_core_sm_definition(context)
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
