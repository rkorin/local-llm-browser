import { StateMachine } from "./state-machine.js";

export function get_core_sm_definition(context) {
  return {
    id: "bootstrap-state-machine",
    startNodeId: "apply-static-resources",
    context,
    eventBus: context.eventBus,
    nodes: [
      {
        id: "apply-static-resources",
        provider: async (machineContext) => {
          machineContext.applyStaticResources();
          machineContext.clearError();
          machineContext.setStatus(machineContext.resources.status.modelLoaded);
          machineContext.setProgress(100);
          return "next";
        },
        next: { next: "verify-provider" },
      },
      {
        id: "verify-provider",
        provider: async (machineContext) => {
          machineContext.setStatus(machineContext.resources.status.checkingModelResponse);
          await machineContext.verifyModelResponse();
          machineContext.renderDebugPanel();
          return "next";
        },
        next: { next: "launch-game-machine" },
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
        provider: async () => "done",
        next: { default: null },
      },
      {
        id: "rerun-debug-prompt",
        provider: async (machineContext) => {
          await machineContext.rerunDebugPrompt();
          return "done";
        },
        next: { default: null },
      },
    ],
  };
}
