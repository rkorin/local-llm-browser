import { EventIds } from "./event-ids.js";

const ALL_EVENTS = "all";
const KNOWN_EVENT_IDS = new Set(Object.values(EventIds));

export class EventMessageBus {
  constructor() {
    this.subscribersByEventId = new Map();
  }

  subscribe(eventId, handler) {
    if (!this.isSupportedSubscriptionEventId(eventId)) {
      throw new Error(`EventMessageBus.subscribe received unknown event id: ${eventId}`);
    }
    if (typeof handler !== "function") {
      throw new Error("EventMessageBus.subscribe requires a function.");
    }

    const subscribers = this.subscribersByEventId.get(eventId) || [];
    subscribers.push(handler);
    this.subscribersByEventId.set(eventId, subscribers);

    return () => {
      const currentSubscribers = this.subscribersByEventId.get(eventId) || [];
      const nextSubscribers = currentSubscribers.filter((item) => item !== handler);

      if (nextSubscribers.length === 0) {
        this.subscribersByEventId.delete(eventId);
        return;
      }

      this.subscribersByEventId.set(eventId, nextSubscribers);
    };
  }

  publish(id, message = null) {
    if (!KNOWN_EVENT_IDS.has(id)) {
      throw new Error(`EventMessageBus.publish received unknown event id: ${id}`);
    }

    const event = { id, message };
    const directSubscribers = this.subscribersByEventId.get(id) || [];
    const allSubscribers = this.subscribersByEventId.get(ALL_EVENTS) || [];

    for (const handler of [...directSubscribers, ...allSubscribers]) {
      handler(event);
    }

    return event;
  }

  isSupportedSubscriptionEventId(eventId) {
    return eventId === ALL_EVENTS || KNOWN_EVENT_IDS.has(eventId);
  }
}
