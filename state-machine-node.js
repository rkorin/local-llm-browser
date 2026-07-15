import { EventMessageBusTimeoutError } from "./event-message-bus.js";

export class StateMachineNode {
  constructor({ id, provider, next = {} } = {}) {
    if (!id) {
      throw new Error("StateMachineNode requires an id.");
    }
    if (typeof provider !== "function") {
      throw new Error(`StateMachineNode "${id}" requires a provider function.`);
    }
    if (!next || typeof next !== "object") {
      throw new Error(`StateMachineNode "${id}" requires a next mapping object.`);
    }

    this.id = id;
    this.provider = provider;
    this.next = next;
  }

  async start(context, machine) {
    return this.provider(context, machine, this);
  }

  resolveNextNodeId(transitionKey, machine) {
    if (Object.prototype.hasOwnProperty.call(this.next, transitionKey)) {
      return this.next[transitionKey];
    }

    if (transitionKey === "error" && machine.errorNodeId) {
      return machine.errorNodeId;
    }

    if (transitionKey === "end" && machine.endNodeId) {
      return machine.endNodeId;
    }

    if (transitionKey && machine.hasNode(transitionKey)) {
      return transitionKey;
    }

    if (Object.prototype.hasOwnProperty.call(this.next, "default")) {
      return this.next.default;
    }

    if (machine.errorNodeId) {
      return machine.errorNodeId;
    }

    return null;
  }

  async nextNodeId(context, machine) {
    try {
      const transitionKey = await this.start(context, machine);
      const normalizedKey = typeof transitionKey === "string" && transitionKey ? transitionKey : "default";
      return {
        transitionKey: normalizedKey,
        nextNodeId: this.resolveNextNodeId(normalizedKey, machine),
      };
    } catch (error) {
      if (error instanceof EventMessageBusTimeoutError) {
        return {
          transitionKey: "error",
          nextNodeId: this.resolveNextNodeId("error", machine),
        };
      }

      throw error;
    }
  }
}
