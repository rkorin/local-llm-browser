export class PresenterBase {
  constructor({ rootId, eventBus } = {}) {
    if (!rootId) {
      throw new Error("PresenterBase requires a rootId.");
    }
    if (!eventBus) {
      throw new Error("PresenterBase requires an event bus.");
    }

    this.rootId = rootId;
    this.eventBus = eventBus;
    this.rootElement = document.getElementById(rootId);

    if (!this.rootElement) {
      throw new Error(`Presenter root not found: ${rootId}`);
    }

    this.cleanupCallbacks = [];
    this.subscriptionSourceBase = `${this.constructor.name}:${rootId}`;
  }

  findById(id) {
    const element = this.rootElement.querySelector(`#${id}`) || document.getElementById(id);
    if (!element) {
      throw new Error(`Presenter element not found: ${id}`);
    }
    return element;
  }

  subscribe(eventId, handler) {
    const sourceId = `${this.subscriptionSourceBase}:${eventId}`;
    const unsubscribe = this.eventBus.subscribe(eventId, sourceId, (event) => {
      handler(event.message, event);
    });

    this.cleanupCallbacks.push(unsubscribe);
    return unsubscribe;
  }

  subscribeMany(subscriptions) {
    for (const subscription of subscriptions) {
      this.subscribe(subscription.eventId, subscription.handler);
    }
  }

  listen(target, eventName, handler, options) {
    target.addEventListener(eventName, handler, options);

    const cleanup = () => {
      target.removeEventListener(eventName, handler, options);
    };

    this.cleanupCallbacks.push(cleanup);
    return cleanup;
  }

  publish(eventId, message = null) {
    this.eventBus.publish(eventId, message);
  }

  initialize() {}

  dispose() {
    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks = [];
  }
}