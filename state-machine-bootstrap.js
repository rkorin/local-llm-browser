import { EventIds } from "./event-ids.js";
import { StateMachine } from "./state-machine.js";
import { getGameStateMachineDefinition } from "./state-machine-game.js";

const DEFAULT_PROVIDER_RETRY_DELAY_MS = 5000;
const APPLY_STATIC_RESOURCES_TIMEOUT_MS = 10000;
const VERIFY_PROVIDER_STATUS_TIMEOUT_MS = 10000;
const SEND_PROVIDER_HEALTHCHECK_TIMEOUT_MS = 60000;
const WAIT_FOR_USER_GAME_START_TIMEOUT_MS = 0;
const WAIT_FOR_GAME_FINISHED_ACTION_TIMEOUT_MS = 0;

function requireObject(context, key) {
  if (!context[key]) {
    throw new Error(`Bootstrap state machine requires context.${key}.`);
  }
}

function validateBootstrapContext(context) {
  if (!context) {
    throw new Error("Bootstrap state machine requires a context.");
  }

  requireObject(context, "eventBus");
}

function providerStatusOf(event) {
  return event?.message?.status || "error";
}

function providerRetryDelayMsOf(context) {
  return Number.isFinite(context?.providerRetryDelayMs)
    ? Math.max(0, Number(context.providerRetryDelayMs))
    : DEFAULT_PROVIDER_RETRY_DELAY_MS;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getCoreStateMachineDefinition(context) {
  validateBootstrapContext(context);

  return {
    id: "bootstrap-state-machine",
    startNode: "apply-static-resources",
    errorNode: "provider-error",
    endNode: "bootstrap-finished",
    context,
    nodes: [
      {
        id: "apply-static-resources",
        provider: async (machineContext, machine) => {
          const resourcesEvent = await machine.publishAndReceive(
            EventIds.appResourcesReadRequested,
            EventIds.appStaticResourcesChanged,
            "bootstrap-state-machine:apply-static-resources",
            machineContext.resourceLanguage,
            APPLY_STATIC_RESOURCES_TIMEOUT_MS,
          );
          machineContext.resources = resourcesEvent.message;
          return "verify-provider";
        },
      },
      {
        id: "verify-provider",
        provider: async (machineContext, machine) => {
          const providerStatusEvent = await machine.publishAndReceive(
            EventIds.providerStatusRequested,
            EventIds.providerStatusChanged,
            "bootstrap-state-machine:verify-provider",
            null,
            VERIFY_PROVIDER_STATUS_TIMEOUT_MS,
          );
          const providerStatus = providerStatusOf(providerStatusEvent);

          machineContext.providerStatus = providerStatus;
          machineContext.providerStatusDetails = providerStatusEvent.message;

          if (providerStatus === "not-selected") {
            return "error";
          }
          if (providerStatus === "initializing") {
            return "wait-for-provider";
          }
          if (providerStatus === "ready") {
            return "send-provider-healthcheck";
          }
          return "error";
        },
      },
      {
        id: "wait-for-provider",
        provider: async (machineContext) => {
          await sleep(providerRetryDelayMsOf(machineContext));
          return "verify-provider";
        },
      },
      {
        id: "provider-error",
        provider: async (machineContext) => {
          machineContext.machineResult = "error";
          return "end";
        },
      },
      {
        id: "send-provider-healthcheck",
        provider: async (machineContext, machine) => {
          const responseEvent = await machine.publishAndReceive(
            EventIds.llmRequestRequested,
            [EventIds.llmResponseReceived, EventIds.llmRequestFailed],
            "bootstrap-state-machine:send-provider-healthcheck",
            machineContext.resources.prompts.healthcheck,
            SEND_PROVIDER_HEALTHCHECK_TIMEOUT_MS,
          );
          machineContext.providerHealthcheckEvent = responseEvent.message;

          if (responseEvent.id === EventIds.llmResponseReceived) {
            machineContext.bootstrapProviderVerified = true;
            return "wait-for-user-game-start";
          }

          return "error";
        },
      },
      {
        id: "wait-for-user-game-start",
        provider: async (_machineContext, machine) => {
          const event = await machine.waitForEventOnce(
            EventIds.uiRestartRequested,
            "bootstrap-state-machine:wait-for-user-game-start",
            WAIT_FOR_USER_GAME_START_TIMEOUT_MS,
          );
          if (event.id === EventIds.uiRestartRequested) {
            return "launch-game-machine";
          }
          return "error";
        },
      },
      {
        id: "launch-game-machine",
        provider: async (machineContext) => {
          const gameStateMachine = new StateMachine(
            machineContext.eventBus,
            (context) => {
              context.resources = machineContext.resources;
              return getGameStateMachineDefinition(context);
            },
          );
          machineContext.gameStateMachine = gameStateMachine;
          const result = await gameStateMachine.run();
          machineContext.lastGameResult = result.status;
          return result.status;
        },
        next: {
          won: "game-finished",
          lost: "game-finished",
          invalid: "game-finished",
          default: "game-finished",
        },
      },
      {
        id: "game-finished",
        provider: async (machineContext, machine) => {
          const finishedMessage = {
            result: machineContext.lastGameResult || "invalid",
          };
          machineContext.eventBus.publish(EventIds.gameFinished, finishedMessage);

          const event = await machine.waitForAnyEventOnce(
            [EventIds.uiGameRetryRequested, EventIds.uiGameCloseRequested],
            "bootstrap-state-machine:game-finished",
            WAIT_FOR_GAME_FINISHED_ACTION_TIMEOUT_MS,
          );

          if (event.id === EventIds.uiGameRetryRequested) {
            return "launch-game-machine";
          }

          machineContext.eventBus.publish(EventIds.gameClosed, finishedMessage);
          machineContext.machineResult = "closed";
          return "end";
        },
      },
      {
        id: "bootstrap-finished",
        provider: async () => "done",
        next: { done: null },
      },
    ],
  };
}
