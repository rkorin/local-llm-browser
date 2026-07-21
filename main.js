import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { MAIN_PRESENTER_ROOT_ID, MainPresenter } from "./presenter-main.js";
import { GAME_PRESENTER_ROOT_ID, GamePresenter } from "./presenter-game.js";
import { DEBUG_PANEL_PRESENTER_ROOT_ID, DebugPanelPresenter } from "./presenter-debug-panel.js";
import { DEFAULT_PROVIDER_TYPE, ProviderFactory } from "./provider-factory.js";
import { DEFAULT_LANGUAGE, ResourceFactory } from "./resource-factory.js";
import { TreeRepository } from "./repository-tree.js";
import { getCoreStateMachineDefinition } from "./state-machine-bootstrap.js";
import { StateMachine } from "./state-machine.js";

class Main {
  async execute() {
    // The event bus is the backbone of the runtime.
    // Most parts of the app communicate through events instead of direct calls.
    const eventBus = new EventMessageBus();

    // Create every long-lived runtime object before publishing startup events.
    const app = {
      eventBus,

      // Resolves localization requests and publishes the active resource bundle.
      resourceFactory: new ResourceFactory(eventBus),

      // Owns provider selection, initialization, status, and LLM request routing.
      providerFactory: new ProviderFactory(eventBus),

      // Persists the learned tree and handles tree commands published by state machines.
      treeRepository: new TreeRepository({ eventBus }),

      // Renders bootstrap/provider status and emits top-level user intent.
      mainPresenter: new MainPresenter({
        rootId: MAIN_PRESENTER_ROOT_ID,
        eventBus,
      }),

      // Renders game screens and publishes answers, animal input, and retry intent.
      gamePresenter: new GamePresenter({
        rootId: GAME_PRESENTER_ROOT_ID,
        eventBus,
      }),

      // Shows LLM diagnostics and publishes manual prompt replay requests.
      debugPanelPresenter: new DebugPanelPresenter({
        rootId: DEBUG_PANEL_PRESENTER_ROOT_ID,
        eventBus,
      }),

      // Orchestrates provider readiness, game rounds, and final session actions.
      bootstrapStateMachine: new StateMachine(
        eventBus,
        (context) => getCoreStateMachineDefinition(context),
      ),
    };

    // Load the default resources explicitly before orchestration starts.
    app.eventBus.publish(EventIds.appResourcesReadRequested, DEFAULT_LANGUAGE);

    // Select the default LLM provider explicitly.
    app.eventBus.publish(EventIds.providerSelectRequested, DEFAULT_PROVIDER_TYPE);

    // Hand control over to the event-driven application flow.
    await app.bootstrapStateMachine.run();
  }
}

// Keep startup explicit so the file remains readable as an architectural script.
const main = new Main();
main.execute().catch((error) => console.error("Application bootstrap failed.", error));
