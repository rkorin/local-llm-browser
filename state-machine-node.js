export class StateMachineNode {
  constructor({ id, provider, next = {} } = {}) {
    if (!id) {
      throw new Error("StateMachineNode requires an id.");
    }
    if (typeof provider !== "function") {
      throw new Error(`StateMachineNode \"${id}\" requires a provider function.`);
    }
    if (!next || typeof next !== "object") {
      throw new Error(`StateMachineNode \"${id}\" requires a next mapping object.`);
    }

    this.id = id;
    this.provider = provider;
    this.next = next;
  }

  async start(context, machine) {
    return this.provider(context, machine, this);
  }

  async nextNodeId(context, machine) {
    const transitionKey = await this.start(context, machine);
    const normalizedKey = typeof transitionKey === "string" && transitionKey ? transitionKey : "default";
    return {
      transitionKey: normalizedKey,
      nextNodeId: this.next[normalizedKey] || this.next.default || null,
    };
  }
}
