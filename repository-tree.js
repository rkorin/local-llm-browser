import { EventIds } from "./event-ids.js";
import { TreeNode } from "./model-tree-node.js";

/**
 * Stores the learned animal tree in localStorage and exposes it only through event-driven commands.
 *
 * Constructor parameters:
 * - `eventBus`: required event bus used for commands and updates.
 * - `storageKey`: required localStorage key for the serialized tree.
 * - `storage`: optional storage adapter, defaults to `globalThis.localStorage`.
 *
 * Accepts:
 * - `tree-root-read-requested` to restore the root `TreeNode` from storage and cache it locally.
 * - `tree-root-save-requested` with the root `TreeNode`; saves that root node and all children to storage.
 * - `tree-root-reset-requested` to clear storage, restore the default root node, and cache it locally.
 *
 * Emits:
 * - `tree-root-loaded` with the current root `TreeNode` after read or reset.
 */
export class TreeRepository {
  constructor({ eventBus, storageKey, storage = globalThis.localStorage } = {}) {
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
  }

  readRawRootNode() {
    try {
      const rawValue = this.storage.getItem(this.storageKey);
      if (!rawValue) {
        return TreeNode.createDefault();
      }

      const parsed = JSON.parse(rawValue);
      return TreeNode.restore(parsed);
    } catch {
      return TreeNode.createDefault();
    }
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

    this.rootNode = rootNode;
    this.storage.setItem(this.storageKey, JSON.stringify(rootNode.serializeGraph()));
    return rootNode;
  }

  handleResetRequested() {
    const defaultRootNode = TreeNode.createDefault();
    this.storage.removeItem(this.storageKey);
    this.rootNode = defaultRootNode;
    this.eventBus.publish(EventIds.treeRootLoaded, defaultRootNode);
    return defaultRootNode;
  }
}
