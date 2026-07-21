import { EventIds } from "./event-ids.js";
import { TreeNode } from "./model-tree-node.js";

export const DEFAULT_TREE_STORAGE_KEY = "animal-question-tree-v1";

/**
 * Stores the learned animal tree in localStorage and exposes it only through event-driven commands.
 *
 * Constructor parameters:
 * - `eventBus`: required event bus used for commands and updates.
 * - `storageKey`: optional localStorage key for the serialized tree; defaults to `DEFAULT_TREE_STORAGE_KEY`.
 * - `storage`: optional storage adapter, defaults to `globalThis.localStorage`.
 *
 * Accepts:
 * - `tree-root-read-requested` to restore the root `TreeNode` from storage and cache it locally.
 * - `tree-root-save-requested` with the root `TreeNode`; saves that root node and all children to storage.
 * - `tree-root-reset-requested` to clear storage, restore the default root node, and cache it locally.
 * - `tree-node-replace-requested` with a target animal node id plus a new question payload.
 *
 * Emits:
 * - `tree-root-loaded` with the current root `TreeNode` after read or reset.
 * - `tree-node-replaced` with the updated root `TreeNode` after a learning replacement.
 */
export class TreeRepository {
  constructor({
    eventBus,
    storageKey = DEFAULT_TREE_STORAGE_KEY,
    storage = globalThis.localStorage,
  } = {}) {
    if (!eventBus) {
      throw new Error("TreeRepository requires an event bus.");
    }
    if (typeof storageKey !== "string" || !storageKey.trim()) {
      throw new Error("TreeRepository requires a non-empty storageKey.");
    }
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      throw new Error("TreeRepository requires a storage adapter with getItem/setItem/removeItem.");
    }

    this.eventBus = eventBus;
    this.storageKey = storageKey.trim();
    this.storage = storage;
    this.rootNode = null;

    this.eventBus.subscribe(EventIds.treeRootReadRequested, "TreeRepository:read", () => {
      this.handleReadRequested();
    });
    this.eventBus.subscribe(EventIds.treeRootSaveRequested, "TreeRepository:save", (event) => {
      this.handleSaveRequested(event.message);
    });
    this.eventBus.subscribe(EventIds.treeRootResetRequested, "TreeRepository:reset", () => {
      this.handleResetRequested();
    });
    this.eventBus.subscribe(EventIds.treeNodeReplaceRequested, "TreeRepository:replace", (event) => {
      this.handleReplaceRequested(event.message);
    });
  }

  readRawRootNode() {
    try {
      const rawValue = this.storage.getItem(this.storageKey);
      if (!rawValue) {
        return TreeNode.createDefault(this.eventBus);
      }

      const parsed = JSON.parse(rawValue);
      return TreeNode.restore(parsed, this.eventBus);
    } catch {
      return TreeNode.createDefault(this.eventBus);
    }
  }

  persistRootNode(rootNode) {
    this.rootNode = rootNode;
    this.storage.setItem(this.storageKey, JSON.stringify(rootNode.serializeGraph()));
    return rootNode;
  }

  handleReadRequested() {
    const loadedRootNode = this.readRawRootNode();
    this.rootNode = loadedRootNode;
    this.eventBus.publish(EventIds.treeRootLoaded, loadedRootNode);
    return loadedRootNode;
  }

  handleSaveRequested(rootNode) {
    if (!(rootNode instanceof TreeNode)) {
      throw new Error("TreeRepository tree-root-save-requested requires a TreeNode root.");
    }

    return this.persistRootNode(rootNode);
  }

  handleResetRequested() {
    const defaultRootNode = TreeNode.createDefault(this.eventBus);
    this.storage.removeItem(this.storageKey);
    this.rootNode = defaultRootNode;
    this.eventBus.publish(EventIds.treeRootLoaded, defaultRootNode);
    return defaultRootNode;
  }

  handleReplaceRequested(payload) {
    const targetNodeId = TreeNode.normalizeNodeId(payload?.targetNodeId);
    const question = String(payload?.question || "").trim();
    const yesAnimalName = String(payload?.yesAnimalName || "").trim();
    const noAnimalName = String(payload?.noAnimalName || "").trim();

    if (targetNodeId === null) {
      throw new Error("TreeRepository tree-node-replace-requested requires targetNodeId.");
    }
    if (!question) {
      throw new Error("TreeRepository tree-node-replace-requested requires question.");
    }
    if (!yesAnimalName || !noAnimalName) {
      throw new Error("TreeRepository tree-node-replace-requested requires yesAnimalName and noAnimalName.");
    }

    const currentRootNode = this.rootNode || this.readRawRootNode();
    const replacementNode = new TreeNode({ eventBus: this.eventBus, question });
    replacementNode.yesNode = new TreeNode({ eventBus: this.eventBus, name: yesAnimalName });
    replacementNode.noNode = new TreeNode({ eventBus: this.eventBus, name: noAnimalName });
    const nextRootNode = currentRootNode.replaceNodeById(targetNodeId, replacementNode);

    this.persistRootNode(nextRootNode);
    this.eventBus.publish(EventIds.treeNodeReplaced, nextRootNode);
    return nextRootNode;
  }
}
