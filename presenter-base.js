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

    this.unsubscribers = [];
  }

  findById(id) {
    const element = this.rootElement.querySelector(`#${id}`) || document.getElementById(id);
    if (!element) {
      throw new Error(`Presenter element not found: ${id}`);
    }
    return element;
  }

  subscribe(eventId, handler) {
    const unsubscribe = this.eventBus.subscribe(eventId, (event) => {
      handler(event.message, event);
    });

    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  publish(eventId, message = null) {
    this.eventBus.publish(eventId, message);
  }

  initialize() {}

  dispose() {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}
