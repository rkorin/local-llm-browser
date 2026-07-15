import { EventIds } from "./event-ids.js";
import { StateMachine } from "./state-machine.js";

/**
 * Bootstrap state machine event/step map.
 *
 * Start node:
 * - `apply-static-resources`
 *
 * Error node:
 * - `provider-error`
 *
 * End node:
 * - `bootstrap-finished`
 *
 * Steps:
 * - `apply-static-resources`
 *   publishes: `app-resources-read-requested`
 *   waits: `app-static-resources-changed`
 *   stores: `machineContext.resources`
 *   next: `verify-provider`
 *
 * - `verify-provider`
 *   publishes: `provider-status-requested`
 *   waits: `provider-status-changed`
 *   stores: `machineContext.providerStatus`, `machineContext.providerStatusDetails`
 *   transitions:
 *   `not-selected` -> `error`
 *   `initializing` -> `wait-for-provider`
 *   `ready` -> `send-provider-healthcheck`
 *
 * - `wait-for-provider`
 *   publishes: nothing
 *   waits: local timer only (`providerRetryDelayMs`, default 5000 ms)
 *   next: `verify-provider`
 *
 * - `provider-error`
 *   publishes: nothing
 *   waits: nothing
 *   stores: `machineContext.machineResult = "error"`
 *   next: `end`
 *
 * - `send-provider-healthcheck`
 *   publishes: `llm-request-requested` with hello prompt
 *   waits: `llm-response-received` or `llm-request-failed`
 *   stores: `machineContext.providerHealthcheckEvent`
 *   transitions:
 *   success -> `wait-for-user-game-start`
 *   failure -> `error`
 *
 * - `wait-for-user-game-start`
 *   publishes: nothing
 *   waits: `ui-restart-requested`
 *   next: `launch-game-machine`
 *
 * - `launch-game-machine`
 *   publishes: nothing directly; nested game machine owns its own events
 *   waits: nested `gameStateMachine.run()` completion
 *   stores: `machineContext.lastGameResult`
 *   transitions: `won | lost | cancelled | invalid -> game-finished`
 *
 * - `game-finished`
 *   publishes: `game-finished` with the last game result
 *   waits: `ui-game-retry-requested` or `ui-game-close-requested`
 *   transitions:
 *   retry -> `launch-game-machine`
 *   close -> publishes `game-closed` and goes to `bootstrap-finished`
 *
 * - `bootstrap-finished`
 *   publishes: nothing
 *   waits: nothing
 *   next: terminal
 *

 */
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 5000;
const APPLY_STATIC_RESOURCES_TIMEOUT_MS = 10000;
const VERIFY_PROVIDER_STATUS_TIMEOUT_MS = 10000;
const SEND_PROVIDER_HEALTHCHECK_TIMEOUT_MS = 60000;
const WAIT_FOR_USER_GAME_START_TIMEOUT_MS = 0;
const WAIT_FOR_GAME_FINISHED_ACTION_TIMEOUT_MS = 0;

function requireFunction(context, key) {
  if (typeof context[key] !== "function") {
    throw new Error(`Bootstrap state machine requires context.${key}().`);
  }
}

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
  requireObject(context, "gameStateMachine");

  if (typeof context.gameStateMachine.run !== "function") {
    throw new Error("Bootstrap state machine requires context.gameStateMachine.run().");
  }
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
    eventBus: context.eventBus,
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
          const result = await machineContext.gameStateMachine.run();
          machineContext.lastGameResult = result.status;
          return result.status;
        },
        next: {
          won: "game-finished",
          lost: "game-finished",
          cancelled: "game-finished",
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

export function get_core_sm_definition(context) {
  return getCoreStateMachineDefinition(context);
}

export function createBootstrapStateMachine(context) {
  return new StateMachine(getCoreStateMachineDefinition(context));
}



