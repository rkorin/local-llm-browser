function createNodeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class TreeNode {
  constructor({ id = createNodeId(), question = "", name = "", yesNode = null, noNode = null } = {}) {
    this.id = id;
    this.question = question;
    this.name = name;
    this.yesNode = yesNode;
    this.noNode = noNode;
  }

  isQuestionNode() {
    return Boolean(this.question);
  }

  isAnimalNode() {
    return Boolean(this.name) && !this.question;
  }

  traverseDepthFirst(visitor, visitedIds = new Set()) {
    if (visitedIds.has(this.id)) {
      return;
    }

    visitedIds.add(this.id);
    visitor(this);
    this.yesNode?.traverseDepthFirst(visitor, visitedIds);
    this.noNode?.traverseDepthFirst(visitor, visitedIds);
  }

  findNodeById(nodeId, visitedIds = new Set()) {
    if (!nodeId || visitedIds.has(this.id)) {
      return null;
    }

    if (this.id === nodeId) {
      return this;
    }

    visitedIds.add(this.id);
    return this.yesNode?.findNodeById(nodeId, visitedIds) || this.noNode?.findNodeById(nodeId, visitedIds) || null;
  }

  findParentOf(nodeId, visitedIds = new Set()) {
    if (!nodeId || visitedIds.has(this.id)) {
      return null;
    }

    if (this.yesNode?.id === nodeId || this.noNode?.id === nodeId) {
      return this;
    }

    visitedIds.add(this.id);
    return this.yesNode?.findParentOf(nodeId, visitedIds) || this.noNode?.findParentOf(nodeId, visitedIds) || null;
  }

  getNodeByPath(path) {
    let node = this;

    for (const step of path) {
      if (step === "yes") {
        node = node?.yesNode || null;
        continue;
      }

      if (step === "no") {
        node = node?.noNode || null;
        continue;
      }

      return null;
    }

    return node;
  }

  replaceNodeByPath(path, nextNode) {
    if (!(nextNode instanceof TreeNode)) {
      throw new Error("Replacement node must be a TreeNode.");
    }

    if (path.length === 0) {
      return nextNode;
    }

    const parentPath = path.slice(0, -1);
    const branchName = path[path.length - 1];
    const parentNode = this.getNodeByPath(parentPath);

    if (!parentNode) {
      throw new Error("Cannot replace node: parent path is invalid.");
    }

    if (branchName === "yes") {
      parentNode.yesNode = nextNode;
      return this;
    }

    if (branchName === "no") {
      parentNode.noNode = nextNode;
      return this;
    }

    throw new Error("Cannot replace node: branch must be yes or no.");
  }

  serializeGraph(visitedIds = new Set(), nodes = {}) {
    if (visitedIds.has(this.id)) {
      return { start: this.id, nodes };
    }

    visitedIds.add(this.id);
    nodes[this.id] = {
      id: this.id,
      yesNodeId: this.yesNode?.id || null,
      noNodeId: this.noNode?.id || null,
      question: this.question || "",
      name: this.name || "",
    };

    if (this.yesNode) {
      this.yesNode.serializeGraph(visitedIds, nodes);
    }

    if (this.noNode) {
      this.noNode.serializeGraph(visitedIds, nodes);
    }

    return { start: this.id, nodes };
  }

  static fromRecord(record) {
    return new TreeNode({
      id: record?.id,
      question: record?.question || "",
      name: record?.name || "",
    });
  }

  static restoreGraph(payload) {
    const records = payload?.nodes;
    const startId = payload?.start;

    if (!records || typeof records !== "object" || !startId || !records[startId]) {
      throw new Error("Invalid tree payload.");
    }

    const restorationLog = {};

    function restoreNode(nodeId) {
      if (!nodeId) {
        return null;
      }

      if (restorationLog[nodeId]) {
        return restorationLog[nodeId];
      }

      const record = records[nodeId];
      if (!record) {
        throw new Error(`Missing node record for id: ${nodeId}`);
      }

      const node = TreeNode.fromRecord(record);
      restorationLog[nodeId] = node;
      node.yesNode = restoreNode(record.yesNodeId);
      node.noNode = restoreNode(record.noNodeId);
      return node;
    }

    return {
      startNode: restoreNode(startId),
      restorationLog,
    };
  }

  static fromLegacyNode(legacyNode) {
    if (!legacyNode || typeof legacyNode !== "object") {
      return new TreeNode({ name: "cat" });
    }

    if (legacyNode.type === "question") {
      return new TreeNode({
        question: legacyNode.question || "",
        yesNode: TreeNode.fromLegacyNode(legacyNode.yes),
        noNode: TreeNode.fromLegacyNode(legacyNode.no),
      });
    }

    return new TreeNode({ name: legacyNode.animal || legacyNode.name || "cat" });
  }

  static createDefault() {
    return new TreeNode({ name: "cat" });
  }

  static restore(payload) {
    if (!payload || typeof payload !== "object") {
      return TreeNode.createDefault();
    }

    if (payload.start && payload.nodes) {
      const { startNode } = TreeNode.restoreGraph(payload);
      return startNode;
    }

    return TreeNode.fromLegacyNode(payload);
  }
}
