import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { StateMachine } from "./state-machine.js";
import { getCoreStateMachineDefinition } from "./state-machine-bootstrap.js";
import {
  assertArrayEqual,
  assertEqual,
  runTest,
} from "./tests.js";

function waitForTransition(eventBus, nodeId) {
  return new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe(EventIds.stateMachineTransitioned, `test:transition:${nodeId}:${Math.random()}`, (event) => {
      if (event.message?.currentNodeId !== nodeId) {
        return;
      }

      unsubscribe();
      resolve(event);
    });
  });
}

function waitForEvent(eventBus, eventId, sourceId) {
  return new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe(eventId, sourceId, (event) => {
      unsubscribe();
      resolve(event);
    });
  });
}

function createBootstrapMachine(context) {
  return new StateMachine(
    context.eventBus,
    (machineContext) => {
      Object.assign(machineContext, context);
      return getCoreStateMachineDefinition(machineContext);
    },
  );
}

function createStubGameDefinition(callLog, nextStatuses) {
  return () => ({
    id: "test-game-state-machine",
    startNode: "run",
    nodes: [
      {
        id: "run",
        provider: async (machineContext) => {
          const runIndex = Number(machineContext.gameRunCount || 0) + 1;
          machineContext.gameRunCount = runIndex;
          callLog.push(`game-state-machine-run${nextStatuses.length > 1 ? `:${runIndex}` : ""}`);
          machineContext.machineResult = nextStatuses[Math.min(runIndex - 1, nextStatuses.length - 1)];
          return machineContext.machineResult;
        },
        next: {
          won: null,
          lost: null,
          invalid: null,
        },
      },
    ],
  });
}

function createBootstrapContext(overrides = {}) {
  const callLog = overrides.callLog || [];
  const eventBus = overrides.eventBus || new EventMessageBus();
  const resolvedResources = overrides.resolvedResources || {
    prompts: {
      healthcheck: "hello",
    },
  };

  if (overrides.attachDefaultHandlers !== false) {
    eventBus.subscribe(EventIds.appResourcesReadRequested, "test:bootstrap:resources", () => {
      callLog.push("request-static-resources");
      eventBus.publish(EventIds.appStaticResourcesChanged, resolvedResources);
    });

    eventBus.subscribe(EventIds.providerStatusRequested, "test:bootstrap:provider-status", () => {
      callLog.push("request-provider-status");
      eventBus.publish(EventIds.providerStatusChanged, {
        status: "ready",
        providerType: "echo",
        requestedProviderType: "echo",
        error: "",
      });
    });

    eventBus.subscribe(EventIds.llmRequestRequested, "test:bootstrap:healthcheck", (event) => {
      callLog.push(`healthcheck:${event.message}`);
      eventBus.publish(EventIds.llmResponseReceived, {
        providerType: "echo",
        prompt: event.message,
        response: "hello",
      });
    });
  }

  return {
    callLog,
    eventBus,
    resourceLanguage: "english",
    resources: null,
    providerStatus: null,
    providerStatusDetails: null,
    providerHealthcheckEvent: null,
    bootstrapProviderVerified: false,
    providerRetryDelayMs: 1,
    buildGameStateMachineDefinition: createStubGameDefinition(callLog, ["won"]),
    ...overrides,
  };
}

export function runBootstrapStateMachineTests() {
  return [
    runTest("state-machine-bootstrap-001 bootstrap machine waits for ready provider, runs hello check, then launches game and closes after finished result screen", async () => {
      const context = createBootstrapContext();
      const machine = createBootstrapMachine(context);
      const waitForUserStartPromise = waitForTransition(context.eventBus, "wait-for-user-game-start");
      const waitForGameFinishedEvent = waitForEvent(context.eventBus, EventIds.gameFinished, "test:bootstrap:finished-event:1");
      const waitForGameClosedEvent = waitForEvent(context.eventBus, EventIds.gameClosed, "test:bootstrap:closed-event:1");
      const resultPromise = machine.run();

      await waitForUserStartPromise;
      context.eventBus.publish(EventIds.uiRestartRequested, null);
      const gameFinishedEvent = await waitForGameFinishedEvent;
      context.eventBus.publish(EventIds.uiGameCloseRequested, null);
      const gameClosedEvent = await waitForGameClosedEvent;
      const result = await resultPromise;

      assertArrayEqual(
        context.callLog,
        [
          "request-static-resources",
          "request-provider-status",
          "healthcheck:hello",
          "game-state-machine-run",
        ],
        "Bootstrap state machine should ask for provider status, run hello check, and then run the nested game machine",
      );
      assertEqual(gameFinishedEvent.message.result, "won", "Bootstrap state machine should publish game-finished with the nested game result.");
      assertEqual(gameClosedEvent.message.result, "won", "Bootstrap state machine should publish game-closed with the same final result when the user closes the session.");
      assertEqual(context.resources.prompts.healthcheck, "hello", "Bootstrap state machine should store resolved resources in local context");
      assertEqual(context.providerStatus, "ready", "Bootstrap state machine should keep the latest provider status in local state");
      assertEqual(context.bootstrapProviderVerified, true, "Bootstrap state machine should mark provider verification after hello succeeded");
      assertEqual(context.lastGameResult, "won", "Bootstrap state machine should remember the nested game result");
      assertEqual(result.status, "closed", "Bootstrap state machine should finish with the closed result when the user closes the finished session");
    }),

    runTest("state-machine-bootstrap-003 missing required context parts fail immediately", async () => {
      let actualMessage = "";

      try {
        new StateMachine(null, (context) => getCoreStateMachineDefinition(context));
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "StateMachine requires an eventBus.", "Bootstrap state machine should fail fast when eventBus is missing");
    }),

    runTest("state-machine-bootstrap-004 provider-not-selected goes to error without hello check or game launch", async () => {
      const callLog = [];
      const eventBus = new EventMessageBus();
      const resolvedResources = { prompts: { healthcheck: "hello" } };

      eventBus.subscribe(EventIds.appResourcesReadRequested, "test:bootstrap:resources:4", () => {
        callLog.push("request-static-resources");
        eventBus.publish(EventIds.appStaticResourcesChanged, resolvedResources);
      });

      eventBus.subscribe(EventIds.providerStatusRequested, "test:bootstrap:provider-status:4", () => {
        callLog.push("request-provider-status");
        eventBus.publish(EventIds.providerStatusChanged, {
          status: "not-selected",
          providerType: null,
          requestedProviderType: null,
          error: "",
        });
      });

      const context = createBootstrapContext({
        callLog,
        eventBus,
        resolvedResources,
        attachDefaultHandlers: false,
      });
      const machine = createBootstrapMachine(context);
      const result = await machine.run();

      assertArrayEqual(
        context.callLog,
        [
          "request-static-resources",
          "request-provider-status",
        ],
        "Bootstrap state machine should stop after provider status reports not-selected",
      );
      assertEqual(result.status, "error", "Bootstrap state machine should finish with error when no provider is selected");
      assertEqual(context.bootstrapProviderVerified, false, "Bootstrap state machine should not mark provider verification when provider is not selected");
    }),

    runTest("state-machine-bootstrap-005 provider-initializing waits and re-checks provider status before hello check", async () => {
      const callLog = [];
      const eventBus = new EventMessageBus();
      const resolvedResources = { prompts: { healthcheck: "hello" } };
      let providerStatusRequests = 0;

      eventBus.subscribe(EventIds.appResourcesReadRequested, "test:bootstrap:resources:5", () => {
        callLog.push("request-static-resources");
        eventBus.publish(EventIds.appStaticResourcesChanged, resolvedResources);
      });

      eventBus.subscribe(EventIds.providerStatusRequested, "test:bootstrap:provider-status:5", () => {
        providerStatusRequests += 1;
        callLog.push("request-provider-status");

        if (providerStatusRequests === 1) {
          eventBus.publish(EventIds.providerStatusChanged, {
            status: "initializing",
            providerType: "echo",
            requestedProviderType: "echo",
            error: "",
          });
          return;
        }

        eventBus.publish(EventIds.providerStatusChanged, {
          status: "ready",
          providerType: "echo",
          requestedProviderType: "echo",
          error: "",
        });
      });

      eventBus.subscribe(EventIds.llmRequestRequested, "test:bootstrap:healthcheck:5", (event) => {
        callLog.push(`healthcheck:${event.message}`);
        eventBus.publish(EventIds.llmResponseReceived, {
          providerType: "echo",
          prompt: event.message,
          response: "hello",
        });
      });

      const context = createBootstrapContext({
        callLog,
        eventBus,
        resolvedResources,
        attachDefaultHandlers: false,
        providerRetryDelayMs: 1,
        buildGameStateMachineDefinition: createStubGameDefinition(callLog, ["won"]),
      });
      const machine = createBootstrapMachine(context);
      const waitForUserStartPromise = waitForTransition(eventBus, "wait-for-user-game-start");
      const waitForGameFinishedEvent = waitForEvent(eventBus, EventIds.gameFinished, "test:bootstrap:finished-event:5");
      const resultPromise = machine.run();

      await waitForUserStartPromise;
      eventBus.publish(EventIds.uiRestartRequested, null);
      await waitForGameFinishedEvent;
      eventBus.publish(EventIds.uiGameCloseRequested, null);
      const result = await resultPromise;

      assertArrayEqual(
        callLog,
        [
          "request-static-resources",
          "request-provider-status",
          "request-provider-status",
          "healthcheck:hello",
          "game-state-machine-run",
        ],
        "Bootstrap state machine should sleep and then re-check provider status before continuing",
      );
      assertEqual(context.providerStatus, "ready", "Bootstrap state machine should update provider status after the re-check returns ready");
      assertEqual(result.status, "closed", "Bootstrap state machine should continue after the provider becomes ready and then allow final close");
    }),

    runTest("state-machine-bootstrap-006 game-finished retry launches a new nested game round", async () => {
      const callLog = [];
      const eventBus = new EventMessageBus();

      eventBus.subscribe(EventIds.appResourcesReadRequested, "test:bootstrap:resources:6", () => {
        callLog.push("request-static-resources");
        eventBus.publish(EventIds.appStaticResourcesChanged, { prompts: { healthcheck: "hello" } });
      });

      eventBus.subscribe(EventIds.providerStatusRequested, "test:bootstrap:provider-status:6", () => {
        callLog.push("request-provider-status");
        eventBus.publish(EventIds.providerStatusChanged, {
          status: "ready",
          providerType: "echo",
          requestedProviderType: "echo",
          error: "",
        });
      });

      eventBus.subscribe(EventIds.llmRequestRequested, "test:bootstrap:healthcheck:6", (event) => {
        callLog.push(`healthcheck:${event.message}`);
        eventBus.publish(EventIds.llmResponseReceived, {
          providerType: "echo",
          prompt: event.message,
          response: "hello",
        });
      });

      const context = createBootstrapContext({
        callLog,
        eventBus,
        attachDefaultHandlers: false,
        buildGameStateMachineDefinition: createStubGameDefinition(callLog, ["lost", "won"]),
      });
      const machine = createBootstrapMachine(context);
      const firstFinishedEventPromise = waitForEvent(eventBus, EventIds.gameFinished, "test:bootstrap:finished-event:6:first");
      const secondFinishedEventPromise = waitForEvent(eventBus, EventIds.gameFinished, "test:bootstrap:finished-event:6:second");
      const resultPromise = machine.run();

      await waitForTransition(eventBus, "wait-for-user-game-start");
      eventBus.publish(EventIds.uiRestartRequested, null);
      const firstFinishedEvent = await firstFinishedEventPromise;
      eventBus.publish(EventIds.uiGameRetryRequested, null);
      const secondFinishedEvent = await secondFinishedEventPromise;
      eventBus.publish(EventIds.uiGameCloseRequested, null);
      const result = await resultPromise;

      assertEqual(firstFinishedEvent.message.result, "lost", "The first game-finished event should expose the first nested game result.");
      assertEqual(secondFinishedEvent.message.result, "won", "Retry should launch a new game round and publish the next result.");
      assertEqual(result.status, "closed", "After retry and final close the bootstrap machine should finish with closed status.");
    }),
  ];
}
