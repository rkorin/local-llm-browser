import { EventIds } from "./event-ids.js";

const ALL_EVENTS = "all";
const KNOWN_EVENT_IDS = new Set(Object.values(EventIds));
const DEFAULT_ONE_TIME_SWEEP_INTERVAL_MS = 5000;
const DEFAULT_PUBLISH_AND_RECEIVE_TIMEOUT_MS = 5000;

/**
 * Central application event dispatcher and runtime-wide ID allocator.
 *
 * Accepts / subscribes to:
 * - no events itself; it stores subscriptions registered by other runtime objects.
 *
 * Emits / publishes:
 * - every event declared in `EventIds`, dispatching it to matching subscribers.
 *
 * Runtime service:
 * - `GetNextId()` returns the next ID from this bus instance's monotonic counter.
 */

export class EventMessageBusTimeoutError extends Error {
  constructor(eventId, sourceId) {
    super(`EventMessageBus.subscribeOne timed out for event "${eventId}" and source "${sourceId}".`);
    this.name = "EventMessageBusTimeoutError";
    this.eventId = eventId;
    this.sourceId = sourceId;
  }
}

export class EventMessageBus {
  constructor({ oneTimeSweepIntervalMs = DEFAULT_ONE_TIME_SWEEP_INTERVAL_MS } = {}) {
    this.subscribersByEventId = new Map();
    this.subscribersByEventIdOne = new Map();
    this.nextId = 1;
    this.oneTimeSweepIntervalMs = this.normalizeTimeout(
      oneTimeSweepIntervalMs,
      "EventMessageBus requires a non-negative one-time sweep interval.",
    );
    this.oneTimeSweepTimerId = setInterval(() => {
      this.removeExpiredOneTimeSubscribers();
    }, this.oneTimeSweepIntervalMs);
  }

  GetNextId() {
    const nextId = this.nextId;
    this.nextId += 1;
    return nextId;
  }

  subscribe(eventId, sourceId, handler) {
    const normalizedSourceId = this.validateSubscription(eventId, sourceId, handler, "subscribe");
    const subscribers = this.subscribersByEventId.get(eventId) || [];
    if (subscribers.some((item) => item.sourceId === normalizedSourceId)) {
      throw new Error(`EventMessageBus.subscribe received duplicate source id "${normalizedSourceId}" for event: ${eventId}`);
    }

    subscribers.push({ sourceId: normalizedSourceId, handler });
    this.subscribersByEventId.set(eventId, subscribers);

    return () => {
      const currentSubscribers = this.subscribersByEventId.get(eventId) || [];
      const nextSubscribers = currentSubscribers.filter((item) => item.sourceId !== normalizedSourceId);

      if (nextSubscribers.length === 0) {
        this.subscribersByEventId.delete(eventId);
        return;
      }

      this.subscribersByEventId.set(eventId, nextSubscribers);
    };
  }

  subscribeOne(eventId, sourceId, timeoutMs, handler, errorHandler) {
    const normalizedSourceId = this.validateSubscription(eventId, sourceId, handler, "subscribeOne");
    if (typeof errorHandler !== "function") {
      throw new Error("EventMessageBus.subscribeOne requires an errorHandler function.");
    }

    const normalizedTimeoutMs = this.normalizeTimeout(
      timeoutMs,
      "EventMessageBus.subscribeOne requires a non-negative timeoutMs.",
    );
    const subscribers = this.subscribersByEventIdOne.get(eventId) || [];
    const subscription = {
      eventId,
      sourceId: normalizedSourceId,
      handler,
      errorHandler,
      expiresAt: normalizedTimeoutMs === 0 ? null : Date.now() + normalizedTimeoutMs,
      subscriptionId: `${normalizedSourceId}:${Date.now()}:${Math.random()}`,
    };

    subscribers.push(subscription);
    this.subscribersByEventIdOne.set(eventId, subscribers);

    return () => {
      this.removeOneSubscription(eventId, subscription.subscriptionId);
    };
  }

  publishAndReceive(
    publishEventId,
    receiveEventId,
    sourceId,
    message = null,
    timeoutMs = DEFAULT_PUBLISH_AND_RECEIVE_TIMEOUT_MS,
  ) {
    const receiveEventIds = Array.isArray(receiveEventId) ? receiveEventId : [receiveEventId];
    if (receiveEventIds.length === 0) {
      throw new Error("EventMessageBus.publishAndReceive requires at least one receive event id.");
    }

    return new Promise((resolve, reject) => {
      const unsubscribers = [];
      let settled = false;

      const settleSuccess = (event) => {
        if (settled) {
          return;
        }

        settled = true;
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        resolve(event);
      };

      const settleError = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        reject(error);
      };

      for (const nextReceiveEventId of receiveEventIds) {
        const unsubscribe = this.subscribeOne(
          nextReceiveEventId,
          sourceId,
          timeoutMs,
          (event) => {
            settleSuccess(event);
          },
          (error) => {
            settleError(error);
          },
        );
        unsubscribers.push(unsubscribe);
      }

      try {
        this.publish(publishEventId, message);
      } catch (error) {
        settleError(error);
      }
    });
  }

  publish(id, message = null) {
    if (!KNOWN_EVENT_IDS.has(id)) {
      throw new Error(`EventMessageBus.publish received unknown event id: ${id}`);
    }

    const event = { id, message };
    const directSubscribers = this.subscribersByEventId.get(id) || [];
    const allSubscribers = this.subscribersByEventId.get(ALL_EVENTS) || [];
    const directOneTimeSubscribers = this.consumeOneTimeSubscribers(id);
    const allOneTimeSubscribers = this.consumeOneTimeSubscribers(ALL_EVENTS);

    for (const subscription of [...directSubscribers, ...allSubscribers]) {
      subscription.handler(event);
    }

    for (const subscription of [...directOneTimeSubscribers, ...allOneTimeSubscribers]) {
      subscription.handler(event);
    }

    return event;
  }

  dispose() {
    clearInterval(this.oneTimeSweepTimerId);
    this.oneTimeSweepTimerId = null;
    this.subscribersByEventId.clear();
    this.subscribersByEventIdOne.clear();
  }

  isSupportedSubscriptionEventId(eventId) {
    return eventId === ALL_EVENTS || KNOWN_EVENT_IDS.has(eventId);
  }

  validateSubscription(eventId, sourceId, handler, methodName) {
    if (!this.isSupportedSubscriptionEventId(eventId)) {
      throw new Error(`EventMessageBus.${methodName} received unknown event id: ${eventId}`);
    }
    if (typeof sourceId !== "string" || !sourceId.trim()) {
      throw new Error(`EventMessageBus.${methodName} requires a non-empty sourceId.`);
    }
    if (typeof handler !== "function") {
      throw new Error(`EventMessageBus.${methodName} requires a function.`);
    }

    return sourceId.trim();
  }

  normalizeTimeout(timeoutMs, errorMessage) {
    const numericTimeoutMs = Number(timeoutMs);
    if (!Number.isFinite(numericTimeoutMs) || numericTimeoutMs < 0) {
      throw new Error(errorMessage);
    }
    return numericTimeoutMs;
  }

  consumeOneTimeSubscribers(eventId) {
    const subscribers = this.subscribersByEventIdOne.get(eventId) || [];
    if (subscribers.length === 0) {
      return [];
    }

    this.subscribersByEventIdOne.delete(eventId);
    return subscribers;
  }

  removeOneSubscription(eventId, subscriptionId) {
    const subscribers = this.subscribersByEventIdOne.get(eventId) || [];
    const nextSubscribers = subscribers.filter((item) => item.subscriptionId !== subscriptionId);

    if (nextSubscribers.length === 0) {
      this.subscribersByEventIdOne.delete(eventId);
      return;
    }

    this.subscribersByEventIdOne.set(eventId, nextSubscribers);
  }

  removeExpiredOneTimeSubscribers() {
    const now = Date.now();

    for (const [eventId, subscribers] of this.subscribersByEventIdOne.entries()) {
      const expiredSubscribers = subscribers.filter((item) => item.expiresAt !== null && item.expiresAt <= now);
      const activeSubscribers = subscribers.filter((item) => item.expiresAt === null || item.expiresAt > now);

      if (activeSubscribers.length === 0) {
        this.subscribersByEventIdOne.delete(eventId);
      } else {
        this.subscribersByEventIdOne.set(eventId, activeSubscribers);
      }

      for (const subscription of expiredSubscribers) {
        subscription.errorHandler(
          new EventMessageBusTimeoutError(eventId, subscription.sourceId),
        );
      }
    }
  }
}
