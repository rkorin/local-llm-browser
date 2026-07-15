import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { TreeNode } from "./model-tree-node.js";
import { TreeRepository } from "./repository-tree.js";
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

    runTest("tree-repository-002 constructor requires a non-empty storage key", async () => {
      const eventBus = new EventMessageBus();

      assertThrows(
        () => new TreeRepository({ eventBus, storageKey: "" }),
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
      assertEqual(repository.rootNode.name, "cat", "TreeRepository should cache the loaded default root locally");
    }),

    runTest("tree-repository-005 read command restores saved tree and emits tree-root-loaded", async () => {
      const savedRoot = new TreeNode({
        question: "Does it bark?",
        yesNode: new TreeNode({ name: "dog" }),
        noNode: new TreeNode({ name: "cat" }),
      });
      const storage = createMemoryStorage(JSON.stringify(savedRoot.serializeGraph()));
      const eventBus = new EventMessageBus();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const loadedPromise = waitForEvent(eventBus, EventIds.treeRootLoaded);

      eventBus.publish(EventIds.treeRootReadRequested, { reason: "startup" });
      const loadedEvent = await loadedPromise;

      assertEqual(loadedEvent.message.question, "Does it bark?", "Stored question tree should be restored from storage");
      assertEqual(loadedEvent.message.yesNode.name, "dog", "Restored tree should preserve the yes branch");
      assertEqual(loadedEvent.message.noNode.name, "cat", "Restored tree should preserve the no branch");
      assertEqual(repository.rootNode.question, "Does it bark?", "TreeRepository should keep the restored root in local state");
    }),

    runTest("tree-repository-006 save command persists the full tree graph from the root node", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage();
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const savedRoot = new TreeNode({
        question: "Does it fly?",
        yesNode: new TreeNode({ name: "owl" }),
        noNode: new TreeNode({ name: "cat" }),
      });

      eventBus.publish(EventIds.treeRootSaveRequested, savedRoot);

      const restoredRoot = TreeNode.restore(JSON.parse(storage.getItem("tree-key")));
      assertEqual(repository.rootNode.question, "Does it fly?", "Saving should update the cached root node");
      assertEqual(restoredRoot.question, "Does it fly?", "Saving should persist the root question");
      assertEqual(restoredRoot.yesNode.name, "owl", "Saving should persist the yes child node");
      assertEqual(restoredRoot.noNode.name, "cat", "Saving should persist the no child node");
    }),

    runTest("tree-repository-007 reset command clears storage and emits the default root", async () => {
      const eventBus = new EventMessageBus();
      const storage = createMemoryStorage(JSON.stringify(new TreeNode({ name: "owl" }).serializeGraph()));
      const repository = new TreeRepository({ eventBus, storageKey: "tree-key", storage });
      const loadedPromise = waitForEvent(eventBus, EventIds.treeRootLoaded);

      eventBus.publish(EventIds.treeRootResetRequested, null);
      const loadedEvent = await loadedPromise;

      assertEqual(storage.getItem("tree-key"), null, "Reset should remove the serialized tree from storage");
      assertEqual(repository.rootNode.name, "cat", "Reset should restore the cached root node to the default tree");
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
  ];
}
