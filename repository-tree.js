import { TreeNode } from "./model-tree-node.js";

export class TreeRepository {
  constructor({ storageKey, storage = globalThis.localStorage } = {}) {
    this.storageKey = storageKey;
    this.storage = storage;
  }

  loadRootNode() {
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

  saveRootNode(rootNode) {
    this.storage.setItem(this.storageKey, JSON.stringify(rootNode.serializeGraph()));
  }

  reset() {
    this.storage.removeItem(this.storageKey);
  }
}
