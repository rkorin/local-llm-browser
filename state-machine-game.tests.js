import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { createGameStateMachine } from "./state-machine-game.js";
import {
  assertArrayEqual,
  assertEqual,
  runTest,
} from "./tests.js";

function waitForMicrotask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createGameContext(overrides = {}) {
  const callLog = [];
  const eventBus = new EventMessageBus();
  const context = {
    callLog,
    eventBus,
    startRoundState() {
      callLog.push("start-round");
    },
    renderCurrentNodeState() {
      callLog.push("render-current-node");
      return "choice";
    },
    async handleYesAction() {
      callLog.push("handle-yes");
      return "won";
    },
    async handleNoAction() {
      callLog.push("handle-no");
      return "ask_animal";
    },
    prepareAnimalInput() {
      callLog.push("prepare-animal-input");
    },
    async handleAnimalSubmitAction() {
      callLog.push("handle-animal-submit");
      return "lost";
    },
    ...overrides,
  };

  return context;
}

export function runGameStateMachineTests() {
  return [
    // state-machine-game-001: yes choice path reaches the won terminal state
    runTest("state-machine-game-001 yes choice path reaches the won terminal state", async () => {
      const context = createGameContext();
      const machine = createGameStateMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceYes, null);
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        ["start-round", "render-current-node", "handle-yes"],
        "Game state machine should execute the yes branch in order",
      );
      assertEqual(result.status, "won", "Game state machine should end with won status after a winning yes branch");
      assertEqual(context.machineResult, "won", "Game state machine should store won as machineResult");
    }),

    // state-machine-game-002: no choice path can collect an animal and end as lost
    runTest("state-machine-game-002 no choice path can collect an animal and end as lost", async () => {
      const context = createGameContext();
      const machine = createGameStateMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        [
          "start-round",
          "render-current-node",
          "handle-no",
          "prepare-animal-input",
          "handle-animal-submit",
        ],
        "Game state machine should execute the animal-learning branch in order",
      );
      assertEqual(result.status, "lost", "Game state machine should end with lost status after learning a new animal");
      assertEqual(context.machineResult, "lost", "Game state machine should store lost as machineResult");
    }),

    // state-machine-game-003: cancel during choice wait ends the round as cancelled
    runTest("state-machine-game-003 cancel during choice wait ends the round as cancelled", async () => {
      const context = createGameContext();
      const machine = createGameStateMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.gameCancel, null);
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        ["start-round", "render-current-node"],
        "Game state machine should stop before yes or no handlers when the round is cancelled from the choice wait",
      );
      assertEqual(result.status, "cancelled", "Game state machine should end with cancelled status when gameCancel arrives in choice wait");
      assertEqual(context.machineResult, "cancelled", "Game state machine should store cancelled as machineResult");
    }),

    // state-machine-game-004: invalid render branch ends immediately as invalid
    runTest("state-machine-game-004 invalid render branch ends immediately as invalid", async () => {
      const context = createGameContext({
        renderCurrentNodeState() {
          context.callLog.push("render-current-node");
          return "invalid";
        },
      });
      const machine = createGameStateMachine(context);

      const result = await machine.run();

      assertArrayEqual(
        context.callLog,
        ["start-round", "render-current-node"],
        "Game state machine should not enter wait states when render returns invalid",
      );
      assertEqual(result.status, "invalid", "Game state machine should end with invalid status when render returns invalid");
      assertEqual(context.machineResult, "invalid", "Game state machine should store invalid as machineResult");
    }),

    // state-machine-game-005: retry after invalid animal input loops back to animal prompt
    runTest("state-machine-game-005 retry after invalid animal input loops back to animal prompt", async () => {
      const context = createGameContext({
        async handleNoAction() {
          context.callLog.push("handle-no");
          return "ask_animal";
        },
        async handleAnimalSubmitAction() {
          context.callLog.push("handle-animal-submit-retry");
          if (!context.hasRetried) {
            context.hasRetried = true;
            return "retry";
          }
          context.callLog.push("handle-animal-submit-lost");
          return "lost";
        },
      });
      const machine = createGameStateMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "???");
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        [
          "start-round",
          "render-current-node",
          "handle-no",
          "prepare-animal-input",
          "handle-animal-submit-retry",
          "prepare-animal-input",
          "handle-animal-submit-retry",
          "handle-animal-submit-lost",
        ],
        "Game state machine should re-enter the animal prompt after a retry transition",
      );
      assertEqual(result.status, "lost", "Game state machine should still reach lost after a retry loop completes");
    }),
  ];
}
