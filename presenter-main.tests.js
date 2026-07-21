import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { MainPresenter } from "./presenter-main.js";
import {
  assertEqual,
  runTest,
} from "./tests.js";

function createMainPresenterFixture() {
  const root = document.createElement("main");
  root.id = "app-root-test";
  root.innerHTML = `
    <h1 id="page-title"></h1>
    <p id="page-description"></p>
    <label>
      <span id="language-label"></span>
      <select id="language-select">
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </label>
    <h2 id="status-title"></h2>
    <div id="progress-bar"></div>
    <div id="status-text"></div>
    <button id="start-game-button" type="button" class="hidden"></button>
    <button id="debug-toggle-button" type="button"></button>
    <button id="reset-tree-button" type="button"></button>
  `;
  document.body.appendChild(root);

  const eventBus = new EventMessageBus();
  const presenter = new MainPresenter({ rootId: root.id, eventBus });

  return {
    root,
    eventBus,
    presenter,
    cleanup() {
      presenter.dispose();
      root.remove();
    },
  };
}

const ENGLISH_RESOURCES = {
  locale: "en",
  ui: {
    pageTitle: "Browser LLM Demo",
    pageDescription: "Minimal browser-only skeleton.",
    languageLabel: "Language",
    languages: {
      en: "English",
      de: "Deutsch",
    },
    startGameButton: "Start Game",
    debugButton: "Debug",
    resetBaseButton: "Reset Base",
    statusTitle: "Status",
  },
  providers: {
    labels: {
      local: "local WebLLM provider",
      echo: "echo provider",
    },
    status: {
      loading: (providerLabel) => `Loading ${providerLabel}...`,
    },
  },
  status: {
    waitingToStart: "Waiting to start...",
    loadingResources: "Loading resources...",
    checkingProviderStatus: "Checking provider status...",
    waitingForProvider: "Waiting for provider...",
    sendingHelloPrompt: "Sending hello prompt and waiting for the provider response...",
    readyToStartGame: "The provider is ready. Start the game when you are ready.",
    modelLoaded: "Model loaded.",
  },
};

export function runMainPresenterTests() {
  return [
    runTest("presenter-main-001 resource event updates main labels", async () => {
      const fixture = createMainPresenterFixture();

      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      assertEqual(fixture.root.querySelector("#page-title").textContent, "Browser LLM Demo", "MainPresenter should render the page title from resources");
      assertEqual(fixture.root.querySelector("#page-description").textContent, "Minimal browser-only skeleton.", "MainPresenter should render the page description from resources");
      assertEqual(fixture.root.querySelector("#language-label").textContent, "Language", "MainPresenter should render the language label from resources");
      assertEqual(fixture.root.querySelector("#status-title").textContent, "Status", "MainPresenter should render the status title from resources");
      assertEqual(fixture.root.querySelector("#start-game-button").textContent, "Start Game", "MainPresenter should render the start game button label from resources");
      assertEqual(fixture.root.querySelector("#debug-toggle-button").textContent, "Debug", "MainPresenter should render the debug button label from resources");
      assertEqual(fixture.root.querySelector("#reset-tree-button").textContent, "Reset Base", "MainPresenter should render the reset button label from resources");

      fixture.cleanup();
    }),

    runTest("presenter-main-002 provider progress updates status text and normalizes percent on provider screens", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "apply-static-resources",
        currentNodeId: "verify-provider",
      });

      fixture.eventBus.publish(EventIds.providerInitializeProgress, {
        providerType: "echo",
        text: "Loading local WebLLM provider...",
        progress: 0.12,
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "Loading local WebLLM provider...", "MainPresenter should show provider progress text on provider-related screens");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "12%", "MainPresenter should normalize fractional provider progress to percent");

      fixture.cleanup();
    }),

    runTest("presenter-main-003 provider verify and wait steps share one visual screen without resetting progress text", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "apply-static-resources",
        currentNodeId: "verify-provider",
      });
      fixture.eventBus.publish(EventIds.providerInitializeProgress, {
        providerType: "echo",
        text: "Loading local WebLLM provider...",
        progress: 0.12,
      });

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "verify-provider",
        currentNodeId: "wait-for-provider",
      });
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "wait-for-provider",
        currentNodeId: "verify-provider",
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "Loading local WebLLM provider...", "MainPresenter should keep the same provider-loading text while verify-provider and wait-for-provider toggle");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "12%", "MainPresenter should keep the same provider-loading progress while verify-provider and wait-for-provider toggle");

      fixture.cleanup();
    }),

    runTest("presenter-main-004 send-provider-healthcheck is a separate screen with complete progress while waiting for hello response", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "verify-provider",
        currentNodeId: "send-provider-healthcheck",
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "Sending hello prompt and waiting for the provider response...", "MainPresenter should treat send-provider-healthcheck as a dedicated post-init screen");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "100%", "MainPresenter should show full progress once the provider is ready and the healthcheck request was sent");

      fixture.cleanup();
    }),

    runTest("presenter-main-005 provider progress does not override unrelated screens", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "verify-provider",
        currentNodeId: "wait-for-user-game-start",
      });

      fixture.eventBus.publish(EventIds.providerInitializeProgress, {
        providerType: "echo",
        text: "Loading local WebLLM provider...",
        progress: 0.12,
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "The provider is ready. Start the game when you are ready.", "MainPresenter should keep the wait-for-user-game-start screen instead of blindly rendering provider progress");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "0%", "MainPresenter should keep the screen-specific progress for wait-for-user-game-start");

      fixture.cleanup();
    }),

    runTest("presenter-main-006 provider completion renders loaded state only during healthcheck screen", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "wait-for-provider",
        currentNodeId: "send-provider-healthcheck",
      });

      fixture.eventBus.publish(EventIds.providerInitializeCompleted, {
        providerType: "echo",
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "Model loaded.", "MainPresenter should render the loaded message after provider completion during the healthcheck stage");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "100%", "MainPresenter should fill the progress bar after provider completion on the healthcheck screen");

      fixture.cleanup();
    }),

    runTest("presenter-main-007 provider failure renders error state", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.providerInitializeFailed, {
        providerType: "echo",
        error: "Unknown provider type: broken",
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "Unknown provider type: broken", "MainPresenter should render provider errors in the status area");
      assertEqual(fixture.root.querySelector("#status-text").classList.contains("error"), true, "MainPresenter should mark provider failures as errors");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "0%", "MainPresenter should reset progress when provider initialization fails");

      fixture.cleanup();
    }),

    runTest("presenter-main-008 bootstrap wait-for-user-game-start shows start button and publishes uiRestartRequested", async () => {
      const fixture = createMainPresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      let publishedEvent = null;
      fixture.eventBus.subscribe(EventIds.uiRestartRequested, "test:presenter-main:start", (event) => {
        publishedEvent = event;
      });

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "bootstrap-state-machine",
        previousNodeId: "send-provider-healthcheck",
        currentNodeId: "wait-for-user-game-start",
      });

      assertEqual(fixture.root.querySelector("#status-text").textContent, "The provider is ready. Start the game when you are ready.", "MainPresenter should render the start-game prompt for the wait-for-user-game-start screen");
      assertEqual(fixture.root.querySelector("#progress-bar").style.width, "0%", "MainPresenter should clear bootstrap progress on the start-game screen");
      assertEqual(fixture.root.querySelector("#start-game-button").classList.contains("hidden"), false, "MainPresenter should show the start game button on the wait-for-user-game-start screen");

      fixture.root.querySelector("#start-game-button").click();

      assertEqual(publishedEvent?.id, EventIds.uiRestartRequested, "MainPresenter should publish uiRestartRequested when the user clicks start game");

      fixture.cleanup();
    }),
  ];
}
