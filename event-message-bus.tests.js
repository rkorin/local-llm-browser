import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import {
  assert,
  assertArrayEqual,
  assertEqual,
  assertThrows,
  runTest,
} from "./tests.js";

export function runEventMessageBusTests() {
  return [
    runTest("create event bus", () => {
      const bus = new EventMessageBus();

      assert(bus instanceof EventMessageBus, "Expected a new EventMessageBus instance.");
    }),
    runTest("subscribe for all receive all", () => {
      const bus = new EventMessageBus();
      const receivedIds = [];

      bus.subscribe("all", (event) => {
        receivedIds.push(event.id);
      });

      bus.publish(EventIds.providerSelected);
      bus.publish(EventIds.uiChoiceYes);

      assertArrayEqual(
        receivedIds,
        [EventIds.providerSelected, EventIds.uiChoiceYes],
        "Subscriber for all events should receive every published known id",
      );
    }),
    runTest("subscribe for single id receive that id and do not receive others", () => {
      const bus = new EventMessageBus();
      const receivedIds = [];

      bus.subscribe(EventIds.providerSelected, (event) => {
        receivedIds.push(event.id);
      });

      bus.publish(EventIds.providerSelected);
      bus.publish(EventIds.uiChoiceYes);

      assertArrayEqual(
        receivedIds,
        [EventIds.providerSelected],
        "Single-id subscriber should receive only its subscribed event id",
      );
    }),
    runTest("subscribe for unknown exception", () => {
      const bus = new EventMessageBus();

      assertThrows(
        () => bus.subscribe("unknown-event-id", () => {}),
        "unknown event id",
      );
    }),
    runTest("publish single id ok", () => {
      const bus = new EventMessageBus();
      let receivedEvent = null;

      bus.subscribe(EventIds.providerSelected, (event) => {
        receivedEvent = event;
      });

      const publishedEvent = bus.publish(EventIds.providerSelected, { ready: true });

      assert(receivedEvent !== null, "Expected subscriber to receive published event.");
      assertEqual(publishedEvent.id, EventIds.providerSelected, "Published event should keep the original id");
      assertEqual(receivedEvent.id, EventIds.providerSelected, "Subscriber should receive the same event id");
      assertEqual(receivedEvent.message.ready, true, "Subscriber should receive the published message payload");
    }),
    runTest("publish all exception", () => {
      const bus = new EventMessageBus();

      assertThrows(
        () => bus.publish("all"),
        "unknown event id",
      );
    }),
    runTest("publish unknown exception", () => {
      const bus = new EventMessageBus();

      assertThrows(
        () => bus.publish("unknown-event-id"),
        "unknown event id",
      );
    }),
  ];
}
