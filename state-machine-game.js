import { EventIds } from "./event-ids.js";
import { StateMachine } from "./state-machine.js";

export function createGameStateMachine(context) {
  return new StateMachine({
    id: "game-state-machine",
    startNodeId: "start-round",
    context,
    eventBus: context.eventBus,
    nodes: [
      {
        id: "start-round",
        provider: async (machineContext) => {
          machineContext.startRoundState();
          return "next";
        },
        next: { next: "render-current-node" },
      },
      {
        id: "render-current-node",
        provider: async (machineContext) => machineContext.renderCurrentNodeState(),
        next: {
          choice: "wait-for-choice",
          invalid: "finish-invalid",
          default: "finish-invalid",
        },
      },
      {
        id: "wait-for-choice",
        provider: async (_machineContext, machine) => {
          const event = await machine.waitForAnyEvent([
            EventIds.uiChoiceYes,
            EventIds.uiChoiceNo,
            EventIds.gameCancel,
          ]);

          if (event.id === EventIds.uiChoiceYes) {
            return "yes";
          }
          if (event.id === EventIds.uiChoiceNo) {
            return "no";
          }
          return "cancel";
        },
        next: {
          yes: "handle-yes",
          no: "handle-no",
          cancel: "finish-cancelled",
          default: "finish-cancelled",
        },
      },
      {
        id: "handle-yes",
        provider: async (machineContext) => machineContext.handleYesAction(),
        next: {
          render: "render-current-node",
          won: "finish-won",
          default: "finish-invalid",
        },
      },
      {
        id: "handle-no",
        provider: async (machineContext) => machineContext.handleNoAction(),
        next: {
          render: "render-current-node",
          ask_animal: "prompt-for-animal",
          default: "finish-invalid",
        },
      },
      {
        id: "prompt-for-animal",
        provider: async (machineContext) => {
          machineContext.prepareAnimalInput();
          return "next";
        },
        next: { next: "wait-for-animal-input" },
      },
      {
        id: "wait-for-animal-input",
        provider: async (_machineContext, machine) => {
          const event = await machine.waitForAnyEvent([
            EventIds.uiAnimalSubmit,
            EventIds.gameCancel,
          ]);

          if (event.id === EventIds.uiAnimalSubmit) {
            return "submitted";
          }
          return "cancel";
        },
        next: {
          submitted: "handle-animal-submit",
          cancel: "finish-cancelled",
          default: "finish-cancelled",
        },
      },
      {
        id: "handle-animal-submit",
        provider: async (machineContext) => machineContext.handleAnimalSubmitAction(),
        next: {
          retry: "prompt-for-animal",
          won: "finish-won",
          lost: "finish-lost",
          default: "finish-invalid",
        },
      },
      {
        id: "finish-won",
        provider: async (machineContext) => {
          machineContext.machineResult = "won";
          return "won";
        },
        next: { default: null },
      },
      {
        id: "finish-lost",
        provider: async (machineContext) => {
          machineContext.machineResult = "lost";
          return "lost";
        },
        next: { default: null },
      },
      {
        id: "finish-invalid",
        provider: async (machineContext) => {
          machineContext.machineResult = "invalid";
          return "invalid";
        },
        next: { default: null },
      },
      {
        id: "finish-cancelled",
        provider: async (machineContext) => {
          machineContext.machineResult = "cancelled";
          return "cancelled";
        },
        next: { default: null },
      },
    ],
  });
}
