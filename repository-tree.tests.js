import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { TreeNode } from "./model-tree-node.js";
import { DEFAULT_TREE_STORAGE_KEY, TreeRepository } from "./repository-tree.js";
import {
  assertEqual,
  assertThrows,
  runTest,
} from "./tests.js";

let sourceCounter = 0;

function nextSourceId(prefix) {
  sourceCounter += 1;
  return `${prefix}:${sourceCounter}`;
}

function createMemoryStorage(initialValue = null) {
  const data = new Map();

  if (initialValue !== null) {
    data.set("tree-key", initialValue);
  }

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function waitForEvent(eventBus, eventId) {
  return new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe(eventId, nextSourceId(`test:wait:${eventId}`), (event) => {
      unsubscribe();
      resolve(event);
    });
  });
}

export function runTreeRepositoryTests() {
  return [
    runTest("tree-repository-001 constructor requires an event bus", async () => {
      assertThrows(
        () => new TreeRepository({ storageKey: "tree-key" }),
        "TreeRepository requires an event bus.",
      );
    }),

    runTest("tree-repository-002 constructor uses the stable default storage key and rejects an explicit empty key", async () => {
      const defaultRepository = new TreeRepository({
        eventBus: new EventMessageBus(),
        storage: createMemoryStorage(),
      });
      assertEqual(
        defaultRepository.storageKey,
        DEFAULT_TREE_STORAGE_KEY,
        "TreeRepository should use the stable application storage key by default",
      );

      assertThrows(
        () => new TreeRepository({ eventBus: new EventMessageBus(), storageKey: "" }),
        "TreeRepository requires a non-empty storageKey.",
      );
    }),

    runTest("tree-repository-003 constructor starts in command-waiting mode", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });

      assertEqual(repository.rootNode, null, "TreeRepository should not preload the tree before a read command arrives");
      assertEqual(repository.storageKey, "tree-key", "TreeRepository should keep the configured storage key");
    }),

    runTest("tree-repository-004 read command loads default tree and emits tree-root-loaded", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const loadedPromise = waitForEvent(eventBus, EventIds.treeRootLoaded);

      eventBus.publish(EventIds.treeRootReadRequested, null);
      const loadedEvent = await loadedPromise;

      assertEqual(loadedEvent.message.name, "cat", "Empty storage should restore the default root animal");
      assertEqual(typeof loadedEvent.message.id, "number", "Default root should always have a numeric id");
      assertEqual(repository.rootNode.name, "cat", "TreeRepository should cache the loaded default root locally");
    }),

    runTest("tree-repository-005 read command restores saved tree with fresh runtime ids and emits tree-root-loaded", async () => {
      const serializationBus = new EventMessageBus();
      const savedRoot = new TreeNode({
        eventBus: serializationBus,
        question: "Does it bark?",
        yesNode: new TreeNode({ eventBus: serializationBus, name: "dog" }),
        noNode: new TreeNode({ eventBus: serializationBus, name: "cat" }),
      });
      const storage = createMemoryStorage(JSON.stringify(savedRoot.serializeGraph()));
      const eventBus = new EventMessageBus();
      eventBus.GetNextId();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const loadedPromise = waitForEvent(eventBus, EventIds.treeRootLoaded);

      eventBus.publish(EventIds.treeRootReadRequested, { reason: "startup" });
      const loadedEvent = await loadedPromise;

      assertEqual(loadedEvent.message.question, "Does it bark?", "Stored question tree should be restored from storage");
      assertEqual(loadedEvent.message.id === savedRoot.id, false, "Restored nodes should receive fresh runtime ids");
      assertEqual(loadedEvent.message.yesNode.name, "dog", "Restored tree should preserve the yes branch");
      assertEqual(loadedEvent.message.noNode.name, "cat", "Restored tree should preserve the no branch");
      assertEqual(repository.rootNode.question, "Does it bark?", "TreeRepository should keep the restored root in local state");
    }),
    runTest("tree-repository-006 save command persists the full tree graph from the root node", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const savedRoot = new TreeNode({
        eventBus,
        question: "Does it fly?",
        yesNode: new TreeNode({ eventBus, name: "owl" }),
        noNode: new TreeNode({ eventBus, name: "cat" }),
      });

      eventBus.publish(EventIds.treeRootSaveRequested, savedRoot);

      const restoredRoot = TreeNode.restore(JSON.parse(storage.getItem("tree-key")), eventBus);
      assertEqual(repository.rootNode.question, "Does it fly?", "Saving should update the cached root node");
      assertEqual(restoredRoot.question, "Does it fly?", "Saving should persist the root question");
      assertEqual(restoredRoot.yesNode.name, "owl", "Saving should persist the yes child node");
      assertEqual(restoredRoot.noNode.name, "cat", "Saving should persist the no child node");
      assertEqual(typeof restoredRoot.id, "number", "Restored nodes should receive numeric runtime ids");
    }),
    runTest("tree-repository-007 reset command clears storage and emits the default root", async () => {
      const serializationBus = new EventMessageBus();
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage(JSON.stringify(new TreeNode({ eventBus: serializationBus, name: "owl" }).serializeGraph()));
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const loadedPromise = waitForEvent(eventBus, EventIds.treeRootLoaded);

      eventBus.publish(EventIds.treeRootResetRequested, null);
      const loadedEvent = await loadedPromise;

      assertEqual(storage.getItem("tree-key"), null, "Reset should remove the serialized tree from storage");
      assertEqual(repository.rootNode.name, "cat", "Reset should restore the cached root node to the default tree");
      assertEqual(typeof repository.rootNode.id, "number", "Reset root should have a numeric runtime id");
      assertEqual(loadedEvent.message.name, "cat", "Reset should emit the default root tree through tree-root-loaded");
    }),
    runTest("tree-repository-008 save command rejects non-TreeNode payloads", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage();
      new TreeRepository({ eventBus, storageKey: "tree-key", storage });

      assertThrows(
        () => eventBus.publish(EventIds.treeRootSaveRequested, { name: "cat" }),
        "TreeRepository tree-root-save-requested requires a TreeNode root.",
      );
    }),

    runTest("tree-repository-009 replace command swaps the root animal node and emits tree-node-replaced", async () => {
      const serializationBus = new EventMessageBus();
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage(JSON.stringify(new TreeNode({ eventBus: serializationBus, name: "cat" }).serializeGraph()));
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const replacedPromise = waitForEvent(eventBus, EventIds.treeNodeReplaced);

      eventBus.publish(EventIds.treeRootReadRequested, null);
      eventBus.publish(EventIds.treeNodeReplaceRequested, {
        targetNodeId: repository.rootNode.id,
        question: "Does it bark?",
        yesAnimalName: "dog",
        noAnimalName: "cat",
      });
      const replacedEvent = await replacedPromise;

      assertEqual(repository.rootNode.question, "Does it bark?", "Replace should swap the root node to the new question node");
      assertEqual(repository.rootNode.id, 2, "Replacement root should get the next runtime id");
      assertEqual(repository.rootNode.yesNode.id, 3, "Replacement yes child should get the next runtime id");
      assertEqual(repository.rootNode.noNode.id, 4, "Replacement no child should get the next runtime id");
      assertEqual(repository.rootNode.yesNode.name, "dog", "Replace should create the yes animal child");
      assertEqual(repository.rootNode.noNode.name, "cat", "Replace should create the no animal child");
      assertEqual(replacedEvent.message.question, "Does it bark?", "Replace should emit the updated root tree");
    }),
    runTest("tree-repository-010 replace command finds a nested node by runtime id and updates only that branch", async () => {
      const serializationBus = new EventMessageBus();
      const savedRoot = new TreeNode({
        eventBus: serializationBus,
        question: "Does it live in water?",
        yesNode: new TreeNode({ eventBus: serializationBus, name: "fish" }),
        noNode: new TreeNode({ eventBus: serializationBus, name: "cat" }),
      });
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage(JSON.stringify(savedRoot.serializeGraph()));
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });

      eventBus.publish(EventIds.treeRootReadRequested, null);
      eventBus.publish(EventIds.treeNodeReplaceRequested, {
        targetNodeId: repository.rootNode.noNode.id,
        question: "Does it bark?",
        yesAnimalName: "dog",
        noAnimalName: "cat",
      });

      assertEqual(repository.rootNode.question, "Does it live in water?", "Nested replace should keep the original root question");
      assertEqual(repository.rootNode.yesNode.name, "fish", "Nested replace should not touch the unrelated yes branch");
      assertEqual(repository.rootNode.noNode.question, "Does it bark?", "Nested replace should replace only the targeted child branch");
      assertEqual(repository.rootNode.noNode.id, 4, "Nested replacement node should get the next runtime id");
      assertEqual(repository.rootNode.noNode.yesNode.id, 5, "Nested replacement yes child should get the next runtime id");
      assertEqual(repository.rootNode.noNode.noNode.id, 6, "Nested replacement no child should get the next runtime id");
      assertEqual(repository.rootNode.noNode.yesNode.name, "dog", "Nested replace should wire the new yes animal into the targeted branch");
    }),
    runTest("tree-repository-011 every restore assigns fresh ids from the shared event bus", async () => {
      const payload = {
        start: 20,
        nodes: {
          20: { id: 20, question: "Does it fly?", yesNodeId: 21, noNodeId: 22, name: "" },
          21: { id: 21, yesNodeId: null, noNodeId: null, question: "", name: "owl" },
          22: { id: 22, yesNodeId: null, noNodeId: null, question: "", name: "cat" },
        },
      };
      const eventBus = new EventMessageBus();
      const firstRoot = TreeNode.restore(payload, eventBus);
      const secondRoot = TreeNode.restore(payload, eventBus);
      const nextNode = new TreeNode({ eventBus, name: "whale" });

      assertEqual(firstRoot.id, 1, "First restore should start from the event bus current id");
      assertEqual(secondRoot.id, 4, "Second restore should create a new runtime object graph");
      assertEqual(firstRoot.id === secondRoot.id, false, "Reloaded root should have a fresh runtime identity");
      assertEqual(nextNode.id, 7, "The shared event bus counter should remain monotonic after restores");
    }),  ];
}
