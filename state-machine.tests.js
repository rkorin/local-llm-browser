import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { StateMachine } from "./state-machine.js";
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

export function runStateMachineTests() {
  return [
    // state-machine-001: runs nodes in order and returns final transition status
    runTest("state-machine-001 runs nodes in order and returns final transition status", async () => {
      const callLog = [];
      const machine = new StateMachine({
        id: "state-machine-test",
        startNode: "start",
        context: { callLog },
        nodes: [
          {
            id: "start",
            provider: async (context) => {
              context.callLog.push("start");
              return "next";
            },
            next: { next: "finish" },
          },
          {
            id: "finish",
            provider: async (context) => {
              context.callLog.push("finish");
              context.machineResult = "completed";
              return "completed";
            },
            next: { completed: null },
          },
        ],
      });

      const result = await machine.run();

      assertArrayEqual(callLog, ["start", "finish"], "StateMachine should execute nodes in transition order");
      assertEqual(machine.currentNodeId, "finish", "StateMachine should keep the last executed node id");
      assertEqual(result.status, "completed", "StateMachine should return machineResult as final status");
      assertEqual(result.context.lastTransitionKey, "completed", "StateMachine should expose the last transition key in context");
    }),

    // state-machine-002: waitForEvent resolves when the matching bus event arrives
    runTest("state-machine-002 waitForEvent resolves when the matching bus event arrives", async () => {
      const eventBus = new EventMessageBus();
      const machine = new StateMachine({
        id: "wait-machine",
        startNode: "idle",
        eventBus,
        nodes: [
          {
            id: "idle",
            provider: async () => "done",
            next: { done: null },
          },
        ],
      });

      const waiter = machine.waitForEvent(EventIds.uiChoiceYes);
      eventBus.publish(EventIds.uiChoiceYes, { answer: true });
      const event = await waiter;

      assertEqual(event.id, EventIds.uiChoiceYes, "waitForEvent should resolve with the published event id");
      assertEqual(event.message.answer, true, "waitForEvent should resolve with the published payload");

      machine.dispose();
      eventBus.dispose();
    }),

    // state-machine-003: waitForAnyEvent resolves with the first matching event
    runTest("state-machine-003 waitForAnyEvent resolves with the first matching event", async () => {
      const eventBus = new EventMessageBus();
      const machine = new StateMachine({
        id: "wait-any-machine",
        startNode: "idle",
        eventBus,
        nodes: [
          {
            id: "idle",
            provider: async () => "done",
            next: { done: null },
          },
        ],
      });

      const waiter = machine.waitForAnyEvent([EventIds.uiChoiceYes, EventIds.uiChoiceNo]);
      eventBus.publish(EventIds.uiChoiceNo, { answer: false });
      const event = await waiter;

      assertEqual(event.id, EventIds.uiChoiceNo, "waitForAnyEvent should resolve with the first matching event");
      assertEqual(event.message.answer, false, "waitForAnyEvent should preserve the winning event payload");

      machine.dispose();
      eventBus.dispose();
    }),

    // state-machine-004: duplicate node ids are rejected early
    runTest("state-machine-004 duplicate node ids are rejected early", async () => {
      let actualMessage = "";

      try {
        new StateMachine({
          nodes: [
            { id: "same", provider: async () => "done", next: { done: null } },
            { id: "same", provider: async () => "done", next: { done: null } },
          ],
        });
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "Duplicate state machine node id: same", "StateMachine should reject duplicate node ids with a clear error");
    }),

    // state-machine-005: run returns current status when called while already running
    runTest("state-machine-005 run returns current status when called while already running", async () => {
      const machine = new StateMachine({
        id: "reentry-machine",
        startNode: "wait",
        context: {},
        nodes: [
          {
            id: "wait",
            provider: async (context) => {
              context.machineResult = "running-node";
              await waitForMicrotask();
              context.machineResult = "done";
              return "done";
            },
            next: { done: null },
          },
        ],
      });

      const firstRunPromise = machine.run();
      const secondRunResult = await machine.run();
      const finalResult = await firstRunPromise;

      assertEqual(secondRunResult.status, "running-node", "StateMachine should expose the current running status on reentry");
      assertEqual(finalResult.status, "done", "StateMachine should still finish the original run normally");
    }),

    // state-machine-006: entering a node publishes a state-machine transition event
    runTest("state-machine-006 entering a node publishes a state-machine transition event", async () => {
      const eventBus = new EventMessageBus();
      const transitions = [];
      eventBus.subscribe(EventIds.stateMachineTransitioned, "test:state-machine:transitions", (event) => {
        transitions.push(event.message);
      });

      const machine = new StateMachine({
        id: "bootstrap-state-machine",
        startNode: "apply-static-resources",
        eventBus,
        context: {},
        nodes: [
          {
            id: "apply-static-resources",
            provider: async () => "next",
            next: { next: "verify-provider" },
          },
          {
            id: "verify-provider",
            provider: async () => "done",
            next: { done: null },
          },
        ],
      });

      await machine.run();

      assertArrayEqual(
        transitions.map((item) => `${item.previousNodeId ?? "null"}->${item.currentNodeId}`),
        ["null->apply-static-resources", "apply-static-resources->verify-provider"],
        "StateMachine should publish a transition event every time it enters a node",
      );
      assertEqual(transitions[0].machineId, "bootstrap-state-machine", "Transition event should include the state machine id");
      machine.dispose();
      eventBus.dispose();
    }),

    // state-machine-007: returning an existing node id works without an explicit next mapping
    runTest("state-machine-007 returning an existing node id works without an explicit next mapping", async () => {
      const callLog = [];
      const machine = new StateMachine({
        id: "implicit-transition-machine",
        startNode: "start",
        context: { callLog },
        nodes: [
          {
            id: "start",
            provider: async (context) => {
              context.callLog.push("start");
              return "finish";
            },
          },
          {
            id: "finish",
            provider: async (context) => {
              context.callLog.push("finish");
              context.machineResult = "done";
              return "done";
            },
            next: { done: null },
          },
        ],
      });

      const result = await machine.run();

      assertArrayEqual(callLog, ["start", "finish"], "StateMachine should allow direct node-id transitions without redundant next mappings");
      assertEqual(result.status, "done", "StateMachine should still finish normally after an implicit node-id transition");
    }),

    // state-machine-008: missing default falls back to the unified error node automatically
    runTest("state-machine-008 missing default falls back to the unified error node automatically", async () => {
      const callLog = [];
      const machine = new StateMachine({
        id: "implicit-error-fallback-machine",
        startNode: "start",
        errorNode: "fail",
        context: { callLog },
        nodes: [
          {
            id: "start",
            provider: async (context) => {
              context.callLog.push("start");
              return "unexpected-transition";
            },
          },
          {
            id: "fail",
            provider: async (context) => {
              context.callLog.push("fail");
              context.machineResult = "error";
              return "done";
            },
            next: { done: null },
          },
        ],
      });

      const result = await machine.run();

      assertArrayEqual(callLog, ["start", "fail"], "StateMachine should route unknown transitions to the shared error node when default is missing");
      assertEqual(result.status, "error", "StateMachine should preserve the shared error result after default fallback");
    }),

    // state-machine-009: returning error goes to the unified error node automatically
    runTest("state-machine-009 returning error goes to the unified error node automatically", async () => {
      const callLog = [];
      const machine = new StateMachine({
        id: "error-node-machine",
        startNode: "start",
        errorNode: "fail",
        context: { callLog },
        nodes: [
          {
            id: "start",
            provider: async (context) => {
              context.callLog.push("start");
              return "error";
            },
          },
          {
            id: "fail",
            provider: async (context) => {
              context.callLog.push("fail");
              context.machineResult = "error";
              return "done";
            },
            next: { done: null },
          },
        ],
      });

      const result = await machine.run();

      assertArrayEqual(callLog, ["start", "fail"], "StateMachine should route error to the shared error node automatically");
      assertEqual(result.status, "error", "StateMachine should preserve the unified error result");
    }),

    // state-machine-010: publishAndReceive timeout from a node provider goes to the unified error node automatically
    runTest("state-machine-010 publishAndReceive timeout from a node provider goes to the unified error node automatically", async () => {
      const callLog = [];
      const eventBus = new EventMessageBus({ oneTimeSweepIntervalMs: 5 });
      const machine = new StateMachine({
        id: "timeout-error-machine",
        startNode: "start",
        errorNode: "fail",
        eventBus,
        context: { callLog },
        nodes: [
          {
            id: "start",
            provider: async (context, currentMachine) => {
              context.callLog.push("start");
              await currentMachine.publishAndReceive(
                EventIds.providerStatusRequested,
                EventIds.providerStatusChanged,
                "test:timeout-error-machine",
                null,
                0,
              );
              context.callLog.push("after-timeout");
              return "done";
            },
            next: { done: null },
          },
          {
            id: "fail",
            provider: async (context) => {
              context.callLog.push("fail");
              context.machineResult = "error";
              return "done";
            },
            next: { done: null },
          },
        ],
      });

      const result = await machine.run();

      assertArrayEqual(callLog, ["start", "fail"], "Timeout inside provider should stop the node and route to the shared error node.");
      assertEqual(result.status, "error", "StateMachine should finish through the unified error path after timeout.");
      machine.dispose();
      eventBus.dispose();
    }),
  ];
}
