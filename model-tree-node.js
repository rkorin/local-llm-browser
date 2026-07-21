function normalizeNodeId(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export class TreeNode {
  static nextNodeId = 1;

  static claimNodeId(value) {
    const normalizedId = normalizeNodeId(value);
    if (normalizedId === null) {
      return null;
    }

    TreeNode.nextNodeId = Math.max(TreeNode.nextNodeId, normalizedId + 1);
    return normalizedId;
  }

  static createNextNodeId() {
    const nextId = TreeNode.nextNodeId;
    TreeNode.nextNodeId += 1;
    return nextId;
  }

  static syncNextNodeId(rootNode) {
    let maxNodeId = 0;

    rootNode?.traverseDepthFirst((node) => {
      const normalizedId = normalizeNodeId(node?.id);
      if (normalizedId !== null) {
        maxNodeId = Math.max(maxNodeId, normalizedId);
      }
    });

    TreeNode.nextNodeId = Math.max(TreeNode.nextNodeId, maxNodeId + 1);
    return TreeNode.nextNodeId;
  }

  static normalizeNodeId(value) {
    return normalizeNodeId(value);
  }

  constructor({ id, question = "", name = "", yesNode = null, noNode = null } = {}) {
    this.id = TreeNode.claimNodeId(id) ?? TreeNode.createNextNodeId();
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
    const normalizedNodeId = TreeNode.normalizeNodeId(nodeId);
    if (normalizedNodeId === null || visitedIds.has(this.id)) {
      return null;
    }

    if (this.id === normalizedNodeId) {
      return this;
    }

    visitedIds.add(this.id);
    return this.yesNode?.findNodeById(normalizedNodeId, visitedIds) || this.noNode?.findNodeById(normalizedNodeId, visitedIds) || null;
  }

  findParentOf(nodeId, visitedIds = new Set()) {
    const normalizedNodeId = TreeNode.normalizeNodeId(nodeId);
    if (normalizedNodeId === null || visitedIds.has(this.id)) {
      return null;
    }

    if (this.yesNode?.id === normalizedNodeId || this.noNode?.id === normalizedNodeId) {
      return this;
    }

    visitedIds.add(this.id);
    return this.yesNode?.findParentOf(normalizedNodeId, visitedIds) || this.noNode?.findParentOf(normalizedNodeId, visitedIds) || null;
  }

  findPathToNode(nodeId, path = [], visitedIds = new Set()) {
    const normalizedNodeId = TreeNode.normalizeNodeId(nodeId);
    if (normalizedNodeId === null || visitedIds.has(this.id)) {
      return null;
    }

    if (this.id === normalizedNodeId) {
      return [...path];
    }

    visitedIds.add(this.id);

    if (this.yesNode) {
      const yesPath = this.yesNode.findPathToNode(normalizedNodeId, [...path, "yes"], visitedIds);
      if (yesPath) {
        return yesPath;
      }
    }

    if (this.noNode) {
      const noPath = this.noNode.findPathToNode(normalizedNodeId, [...path, "no"], visitedIds);
      if (noPath) {
        return noPath;
      }
    }

    return null;
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

  replaceNodeById(nodeId, nextNode) {
    const path = this.findPathToNode(nodeId);
    if (path === null) {
      throw new Error(`Cannot replace node: target id not found: ${nodeId}`);
    }

    return this.replaceNodeByPath(path, nextNode);
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
    const startId = TreeNode.normalizeNodeId(payload?.start);

    if (!records || typeof records !== "object" || startId === null || !records[String(startId)]) {
      throw new Error("Invalid tree payload.");
    }

    const restorationLog = {};

    function restoreNode(nodeId) {
      const normalizedNodeId = TreeNode.normalizeNodeId(nodeId);
      if (normalizedNodeId === null) {
        return null;
      }

      if (restorationLog[normalizedNodeId]) {
        return restorationLog[normalizedNodeId];
      }

      const record = records[String(normalizedNodeId)];
      if (!record) {
        throw new Error(`Missing node record for id: ${normalizedNodeId}`);
      }

      const node = TreeNode.fromRecord(record);
      restorationLog[normalizedNodeId] = node;
      node.yesNode = restoreNode(record.yesNodeId);
      node.noNode = restoreNode(record.noNodeId);
      return node;
    }

    const startNode = restoreNode(startId);
    TreeNode.syncNextNodeId(startNode);

    return {
      startNode,
      restorationLog,
    };
  }

  static fromLegacyNode(legacyNode) {
    if (!legacyNode || typeof legacyNode !== "object") {
      return new TreeNode({ name: "cat" });
    }

    const normalizedId = TreeNode.normalizeNodeId(legacyNode.id);

    if (legacyNode.type === "question") {
      return new TreeNode({
        id: normalizedId,
        question: legacyNode.question || "",
        yesNode: TreeNode.fromLegacyNode(legacyNode.yes),
        noNode: TreeNode.fromLegacyNode(legacyNode.no),
      });
    }

    return new TreeNode({
      id: normalizedId,
      name: legacyNode.animal || legacyNode.name || "cat",
    });
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

    const restoredNode = TreeNode.fromLegacyNode(payload);
    TreeNode.syncNextNodeId(restoredNode);
    return restoredNode;
  }
}
