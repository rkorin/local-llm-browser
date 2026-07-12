import { StateMachineNode } from "./state-machine-node.js";

export class StateMachine {
  constructor({ id, startNodeId, nodes = [], context = {}, eventBus = null } = {}) {
    this.id = id || "state-machine";
    this.startNodeId = startNodeId || null;
    this.context = context;
    this.eventBus = eventBus;
    this.currentNodeId = null;
    this.isRunning = false;
    this.nodes = new Map();
    this.eventWaiters = new Map();
    this.unsubscribeFromBus = null;

    for (const config of nodes) {
      const node = config instanceof StateMachineNode ? config : new StateMachineNode(config);
      if (this.nodes.has(node.id)) {
        throw new Error(`Duplicate state machine node id: ${node.id}`);
      }
      this.nodes.set(node.id, node);
    }

    if (this.eventBus) {
      this.unsubscribeFromBus = this.eventBus.subscribe("all", (event) => {
        this.handleEvent(event);
      });
    }
  }

  getNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Unknown state machine node: ${nodeId}`);
    }
    return node;
  }

  handleEvent(event) {
    const waiters = this.eventWaiters.get(event.id);
    if (!waiters || waiters.length === 0) {
      return;
    }

    this.eventWaiters.delete(event.id);
    for (const resolve of waiters) {
      resolve(event);
    }
  }

  waitForEvent(id) {
    return new Promise((resolve) => {
      const waiters = this.eventWaiters.get(id) || [];
      waiters.push(resolve);
      this.eventWaiters.set(id, waiters);
    });
  }

  waitForAnyEvent(ids) {
    return Promise.race(ids.map((id) => this.waitForEvent(id)));
  }

  async run(startNodeId = this.startNodeId) {
    if (this.isRunning) {
      return {
        status: this.context.machineResult || this.context.lastTransitionKey || "running",
        context: this.context,
      };
    }

    if (!startNodeId) {
      throw new Error(`State machine "${this.id}" has no start node.`);
    }

    this.context.machineResult = null;
    this.isRunning = true;
    let nextNodeId = startNodeId;

    while (this.isRunning && nextNodeId) {
      this.currentNodeId = nextNodeId;
      const node = this.getNode(nextNodeId);
      const resolution = await node.nextNodeId(this.context, this);
      this.context.lastTransitionKey = resolution.transitionKey;
      nextNodeId = resolution.nextNodeId;
    }

    this.isRunning = false;
    return {
      status: this.context.machineResult || this.context.lastTransitionKey || "done",
      context: this.context,
    };
  }

  stop() {
    this.isRunning = false;
  }

  dispose() {
    this.stop();
    this.eventWaiters.clear();
    this.unsubscribeFromBus?.();
    this.unsubscribeFromBus = null;
  }
}
