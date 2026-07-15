import { EventIds } from "./event-ids.js";
import { StateMachineNode } from "./state-machine-node.js";

const DEFAULT_MACHINE_PUBLISH_AND_RECEIVE_TIMEOUT_MS = 5000;

export class StateMachine {
  constructor({ id, startNodeId, startNode, errorNodeId, errorNode, endNodeId, endNode, nodes = [], context = {}, eventBus = null } = {}) {
    this.id = id || "state-machine";
    this.startNodeId = startNode || startNodeId || null;
    this.errorNodeId = errorNode || errorNodeId || null;
    this.endNodeId = endNode || endNodeId || null;
    this.context = context;
    this.eventBus = eventBus;
    this.currentNodeId = null;
    this.isRunning = false;
    this.nodes = new Map();
    this.eventWaiters = new Map();
    this.unsubscribeFromBus = null;
    this.subscriptionSourceId = `StateMachine:${this.id}:all`;

    for (const config of nodes) {
      const node = config instanceof StateMachineNode ? config : new StateMachineNode(config);
      if (this.nodes.has(node.id)) {
        throw new Error(`Duplicate state machine node id: ${node.id}`);
      }
      this.nodes.set(node.id, node);
    }

    if (this.eventBus) {
      this.unsubscribeFromBus = this.eventBus.subscribe("all", this.subscriptionSourceId, (event) => {
        this.handleEvent(event);
      });
    }
  }

  hasNode(nodeId) {
    return this.nodes.has(nodeId);
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

  waitForEventOnce(id, sourceId, timeoutMs) {
    if (!this.eventBus || typeof this.eventBus.subscribeOne !== "function") {
      throw new Error(`StateMachine "${this.id}" requires an event bus with subscribeOne().`);
    }

    return new Promise((resolve, reject) => {
      this.eventBus.subscribeOne(
        id,
        sourceId,
        timeoutMs,
        (event) => {
          resolve(event);
        },
        (error) => {
          reject(error);
        },
      );
    });
  }

  waitForAnyEvent(ids) {
    return Promise.race(ids.map((id) => this.waitForEvent(id)));
  }

  waitForAnyEventOnce(ids, sourceId, timeoutMs) {
    if (!this.eventBus || typeof this.eventBus.subscribeOne !== "function") {
      throw new Error(`StateMachine "${this.id}" requires an event bus with subscribeOne().`);
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

      for (const id of ids) {
        const unsubscribe = this.eventBus.subscribeOne(
          id,
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
    });
  }

  async publishAndReceive(
    publishEventId,
    receiveEventId,
    sourceId,
    message = null,
    timeoutMs = DEFAULT_MACHINE_PUBLISH_AND_RECEIVE_TIMEOUT_MS,
  ) {
    if (!this.eventBus || typeof this.eventBus.publishAndReceive !== "function") {
      throw new Error(`StateMachine "${this.id}" requires an event bus with publishAndReceive().`);
    }

    return this.eventBus.publishAndReceive(
      publishEventId,
      receiveEventId,
      sourceId,
      message,
      timeoutMs,
    );
  }

  publishTransitionEvent(previousNodeId, currentNodeId) {
    if (!this.eventBus) {
      return;
    }

    this.eventBus.publish(EventIds.stateMachineTransitioned, {
      machineId: this.id,
      previousNodeId,
      currentNodeId,
    });
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
    let previousNodeId = null;

    while (this.isRunning && nextNodeId) {
      this.currentNodeId = nextNodeId;
      this.publishTransitionEvent(previousNodeId, nextNodeId);
      const node = this.getNode(nextNodeId);
      const resolution = await node.nextNodeId(this.context, this);
      this.context.lastTransitionKey = resolution.transitionKey;
      previousNodeId = nextNodeId;
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
