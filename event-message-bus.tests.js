import { EventIds } from "./event-ids.js";
import { EventMessageBus, EventMessageBusTimeoutError } from "./event-message-bus.js";
import {
  assert,
  assertArrayEqual,
  assertEqual,
  assertThrows,
  runTest,
} from "./tests.js";

export function runEventMessageBusTests() {
  return [
    runTest("event-message-bus-001 create event bus", () => {
      const bus = new EventMessageBus();
      assert(bus instanceof EventMessageBus, "Expected a new EventMessageBus instance.");
      bus.dispose();
    }),
    runTest("event-message-bus-002 subscribe for all receives all events", () => {
      const bus = new EventMessageBus();
      const receivedIds = [];
      bus.subscribe("all", "test:all", (event) => {
        receivedIds.push(event.id);
      });
      bus.publish(EventIds.providerSelected);
      bus.publish(EventIds.uiChoiceYes);
      assertArrayEqual(receivedIds, [EventIds.providerSelected, EventIds.uiChoiceYes], "Subscriber for all events should receive every published known id");
      bus.dispose();
    }),
    runTest("event-message-bus-003 single-id subscriber receives only its event", () => {
      const bus = new EventMessageBus();
      const receivedIds = [];
      bus.subscribe(EventIds.providerSelected, "test:provider-selected", (event) => {
        receivedIds.push(event.id);
      });
      bus.publish(EventIds.providerSelected);
      bus.publish(EventIds.uiChoiceYes);
      assertArrayEqual(receivedIds, [EventIds.providerSelected], "Single-id subscriber should receive only its subscribed event id");
      bus.dispose();
    }),
    runTest("event-message-bus-004 subscribe rejects unknown event id", () => {
      const bus = new EventMessageBus();
      assertThrows(() => bus.subscribe("unknown-event-id", "test:unknown", () => {}), "unknown event id");
      bus.dispose();
    }),
    runTest("event-message-bus-005 publish returns and forwards event payload", () => {
      const bus = new EventMessageBus();
      let receivedEvent = null;
      bus.subscribe(EventIds.providerSelected, "test:payload", (event) => {
        receivedEvent = event;
      });
      const publishedEvent = bus.publish(EventIds.providerSelected, { ready: true });
      assert(receivedEvent !== null, "Expected subscriber to receive published event.");
      assertEqual(publishedEvent.id, EventIds.providerSelected, "Published event should keep the original id");
      assertEqual(receivedEvent.id, EventIds.providerSelected, "Subscriber should receive the same event id");
      assertEqual(receivedEvent.message.ready, true, "Subscriber should receive the published message payload");
      bus.dispose();
    }),
    runTest("event-message-bus-006 publish rejects reserved all channel", () => {
      const bus = new EventMessageBus();
      assertThrows(() => bus.publish("all"), "unknown event id");
      bus.dispose();
    }),
    runTest("event-message-bus-007 publish rejects unknown event id", () => {
      const bus = new EventMessageBus();
      assertThrows(() => bus.publish("unknown-event-id"), "unknown event id");
      bus.dispose();
    }),
    runTest("event-message-bus-008 subscribe rejects missing source id", () => {
      const bus = new EventMessageBus();
      assertThrows(() => bus.subscribe(EventIds.providerSelected, "", () => {}), "sourceId");
      bus.dispose();
    }),
    runTest("event-message-bus-009 subscribe rejects duplicate source id for the same event", () => {
      const bus = new EventMessageBus();
      bus.subscribe(EventIds.providerSelected, "test:duplicate", () => {});
      assertThrows(() => bus.subscribe(EventIds.providerSelected, "test:duplicate", () => {}), "duplicate source id");
      bus.dispose();
    }),
    runTest("event-message-bus-010 subscribeOne allows the same source id to wait multiple times for the same event", () => {
      const bus = new EventMessageBus();
      const received = [];
      bus.subscribeOne(EventIds.providerStatusChanged, "test:one", 1000, (event) => {
        received.push(`first:${event.id}`);
      }, () => {
        received.push("first:error");
      });
      bus.subscribeOne(EventIds.providerStatusChanged, "test:one", 1000, (event) => {
        received.push(`second:${event.id}`);
      }, () => {
        received.push("second:error");
      });
      bus.publish(EventIds.providerStatusChanged, { status: "ready" });
      assertArrayEqual(received, [`first:${EventIds.providerStatusChanged}`, `second:${EventIds.providerStatusChanged}`], "subscribeOne should allow multiple one-time waits from the same source id");
      bus.dispose();
    }),
    runTest("event-message-bus-011 subscribeOne clears all one-time subscribers for the published event", () => {
      const bus = new EventMessageBus();
      let receiveCount = 0;
      bus.subscribeOne(EventIds.providerStatusChanged, "test:clear:1", 1000, () => {
        receiveCount += 1;
      }, () => {
        receiveCount += 100;
      });
      bus.subscribeOne(EventIds.providerStatusChanged, "test:clear:2", 1000, () => {
        receiveCount += 1;
      }, () => {
        receiveCount += 100;
      });
      bus.publish(EventIds.providerStatusChanged, { status: "ready" });
      bus.publish(EventIds.providerStatusChanged, { status: "ready-again" });
      assertEqual(receiveCount, 2, "One-time subscribers should be removed after the first matching publish.");
      bus.dispose();
    }),
    runTest("event-message-bus-012 subscribeOne times out and reports the timeout exception through the error handler", async () => {
      const bus = new EventMessageBus({ oneTimeSweepIntervalMs: 5 });
      let timeoutError = null;
      bus.subscribeOne(EventIds.providerStatusChanged, "test:timeout", 1, () => {
        timeoutError = new Error("handler should not be called");
      }, (error) => {
        timeoutError = error;
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      assert(timeoutError instanceof EventMessageBusTimeoutError, "Expired subscribeOne should report EventMessageBusTimeoutError.");
      assertEqual(timeoutError.eventId, EventIds.providerStatusChanged, "Timeout exception should keep the awaited event id.");
      assertEqual(timeoutError.sourceId, "test:timeout", "Timeout exception should keep the source id.");
      bus.dispose();
    }),
    runTest("event-message-bus-013 subscribeOne with timeout 0 waits without expiring", async () => {
      const bus = new EventMessageBus({ oneTimeSweepIntervalMs: 5 });
      let receivedEvent = null;
      let timeoutError = null;
      bus.subscribeOne(EventIds.providerStatusChanged, "test:no-timeout", 0, (event) => {
        receivedEvent = event;
      }, (error) => {
        timeoutError = error;
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      assertEqual(timeoutError, null, "subscribeOne with timeout 0 should not expire on the sweep timer.");
      bus.publish(EventIds.providerStatusChanged, { status: "ready" });
      assertEqual(receivedEvent?.id, EventIds.providerStatusChanged, "subscribeOne with timeout 0 should still receive the next matching event.");
      bus.dispose();
    }),
    runTest("event-message-bus-014 publishAndReceive waits for the response event and resolves with it", async () => {
      const bus = new EventMessageBus({ oneTimeSweepIntervalMs: 5 });
      bus.subscribe(EventIds.providerStatusRequested, "test:publish-and-receive", () => {
        bus.publish(EventIds.providerStatusChanged, { status: "ready" });
      });
      const event = await bus.publishAndReceive(EventIds.providerStatusRequested, EventIds.providerStatusChanged, "test:publish-and-receive:wait", null, 100);
      assertEqual(event.id, EventIds.providerStatusChanged, "publishAndReceive should resolve with the awaited event.");
      assertEqual(event.message.status, "ready", "publishAndReceive should keep the response payload.");
      bus.dispose();
    }),
    runTest("event-message-bus-015 publishAndReceive resolves with the first event from the accepted response set", async () => {
      const bus = new EventMessageBus({ oneTimeSweepIntervalMs: 5 });
      bus.subscribe(EventIds.llmRequestRequested, "test:publish-and-receive:any", () => {
        bus.publish(EventIds.llmRequestFailed, { error: "boom" });
      });
      const event = await bus.publishAndReceive(EventIds.llmRequestRequested, [EventIds.llmResponseReceived, EventIds.llmRequestFailed], "test:publish-and-receive:any:wait", "hello", 100);
      assertEqual(event.id, EventIds.llmRequestFailed, "publishAndReceive should resolve with whichever allowed response event arrives first.");
      assertEqual(event.message.error, "boom", "publishAndReceive should preserve the payload of the winning response event.");
      bus.dispose();
    }),
  ];
}
