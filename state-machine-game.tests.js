import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { TreeNode } from "./model-tree-node.js";
import { StateMachine } from "./state-machine.js";
import { getGameStateMachineDefinition } from "./state-machine-game.js";
import {
  assertArrayEqual,
  assertEqual,
  runTest,
} from "./tests.js";

function waitForMicrotask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function wireTreeRepositoryMock(eventBus, rootNode) {
  eventBus.subscribe(EventIds.treeRootReadRequested, `test:tree-read:${Math.random()}`, () => {
    eventBus.publish(EventIds.treeRootLoaded, rootNode);
  });

  eventBus.subscribe(EventIds.treeNodeReplaceRequested, `test:tree-replace:${Math.random()}`, (event) => {
    const message = event.message;
    eventBus.publish(EventIds.treeNodeReplaced, new TreeNode({
      question: message.question,
      yesNode: new TreeNode({ name: message.yesAnimalName }),
      noNode: new TreeNode({ name: message.noAnimalName }),
    }));
  });
}

function wireLlmMock(eventBus, overrides = {}) {
  eventBus.subscribe(EventIds.llmRequestRequested, `test:llm:${Math.random()}`, (event) => {
    const prompt = String(event.message || "");

    if (prompt.includes("USER_INPUT")) {
      if (typeof overrides.handleValidateAnimalPrompt === "function") {
        overrides.handleValidateAnimalPrompt(prompt, eventBus);
        return;
      }

      eventBus.publish(EventIds.llmResponseReceived, {
        providerType: "echo",
        prompt,
        response: JSON.stringify({
          isValid: true,
          normalizedAnimal: "whale",
          reasonCode: "valid",
        }),
      });
      return;
    }

    eventBus.publish(EventIds.llmResponseReceived, {
      providerType: "echo",
      prompt,
      response: JSON.stringify({}),
    });
  });
}

function createGameMachine(context) {
  return new StateMachine(
    context.eventBus,
    (machineContext) => {
      Object.assign(machineContext, context);
      return getGameStateMachineDefinition(machineContext);
    },
  );
}

function createGameContext(overrides = {}) {
  const callLog = [];
  const eventBus = overrides.eventBus || new EventMessageBus();
  const rootNode = overrides.rootNode || new TreeNode({ id: 1, name: "cat" });
  wireTreeRepositoryMock(eventBus, rootNode);
  wireLlmMock(eventBus, overrides);

  return {
    callLog,
    eventBus,
    resources: {
      prompts: {
        game: {
          validateAnimalInput: (failedAnimalName, userInput) => `FAILED_ANIMAL_NAME=${failedAnimalName}; USER_INPUT=${userInput}`,
        },
      },
    },
    rootNode: null,
    currentNode: null,
    invalidAnimalDelayMs: 0,
    generateDistinguishingQuestion() {
      callLog.push(`generate-question:${this.questionGenerationAttemptCount}`);
      this.generatedQuestion = "Does it live in water?";
      this.generatedQuestionYesAnimal = "whale";
      this.generatedQuestionNoAnimal = "cat";
      return {
        question: this.generatedQuestion,
        yesAnimal: this.generatedQuestionYesAnimal,
        noAnimal: this.generatedQuestionNoAnimal,
      };
    },
    validateGeneratedQuestion() {
      callLog.push("validate-generated-question");
      return "valid";
    },
    ...overrides,
  };
}

export function runGameStateMachineTests() {
  return [
    runTest("state-machine-game-001 root animal guess emits one question event and reaches won on yes", async () => {
      const context = createGameContext();
      const machine = createGameMachine(context);
      const published = [];
      context.eventBus.subscribe("all", "test:game-events:001", (event) => {
        published.push(event);
      });
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceYes, null);
      const result = await runPromise;

      const questionEvents = published.filter((event) => event.id === EventIds.gameQuestionAsked);

      assertEqual(questionEvents.length, 1, "Game state machine should publish exactly one question event for an animal guess");
      assertEqual(questionEvents[0].message.kind, "yes-no-question", "Game state machine should mark the question as a yes/no question");
      assertEqual(questionEvents[0].message.text, "Is it cat?", "Game state machine should publish the animal guess question text");
      assertArrayEqual(
        context.callLog,
        [],
        "Game state machine should not call extra context functions during a winning animal guess",
      );
      assertEqual(result.status, "won", "Game state machine should end with won status after a winning animal guess");
      assertEqual(context.currentNode.name, "cat", "Game state machine should keep the current node on the guessed animal when the answer is yes");
      assertEqual(context.gameResultForParentSm, "won", "Game state machine should store the won result for the parent state machine");
    }),

    runTest("state-machine-game-002 question branch can traverse and then learn a new animal", async () => {
      const rootNode = new TreeNode({
        id: 10,
        question: "Does it fly?",
        yesNode: new TreeNode({ id: 11, name: "eagle" }),
        noNode: new TreeNode({ id: 12, name: "cat" }),
      });
      const context = createGameContext({ rootNode });
      const machine = createGameMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        [
          "generate-question:1",
          "validate-generated-question",
        ],
        "Game state machine should traverse a question node, validate the animal, and continue learning",
      );
      assertEqual(result.status, "lost", "Game state machine should end with lost status after learning a new animal");
      assertEqual(context.failedAnimalNodeId, 12, "Game state machine should remember the failed animal node id for learning");
      assertEqual(context.userAnimalInput, "whale", "Game state machine should store the user animal input at step 7");
      assertEqual(context.userAnimalName, "whale", "Game state machine should store the normalized user animal name after step 8");
      assertEqual(context.rootNode.question, "Does it live in water?", "Game state machine should keep the replaced root from the repository response");
    }),

    runTest("state-machine-game-003 invalid current node still throws a clear error", async () => {
      const rootNode = {
        isAnimalNode() {
          return false;
        },
      };
      const context = createGameContext({ rootNode });
      const machine = createGameMachine(context);

      let actualMessage = "";
      try {
        await machine.run();
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "Cannot read properties of undefined (reading 'question')", "Game state machine should fail loudly when root node does not respect the TreeNode contract");
      assertArrayEqual(
        context.callLog,
        [],
        "Game state machine should not ask gameplay questions when the root node is structurally invalid",
      );
    }),

    runTest("state-machine-game-004 invalid animal input loops back to step 7 before succeeding", async () => {
      let validateAnimalCalls = 0;
      const context = createGameContext({
        generatedCalls: 0,
        handleValidateAnimalPrompt(prompt, eventBus) {
          validateAnimalCalls += 1;
          if (validateAnimalCalls === 1) {
            eventBus.publish(EventIds.llmResponseReceived, {
              providerType: "echo",
              prompt,
              response: JSON.stringify({
                isValid: false,
                normalizedAnimal: "",
                reasonCode: "not_an_animal",
              }),
            });
            return;
          }

          eventBus.publish(EventIds.llmResponseReceived, {
            providerType: "echo",
            prompt,
            response: JSON.stringify({
              isValid: true,
              normalizedAnimal: "whale",
              reasonCode: "valid",
            }),
          });
        },
        generateDistinguishingQuestion() {
          this.generatedCalls += 1;
          this.callLog.push(`generate-question:${this.generatedCalls}`);
          this.generatedQuestion = this.generatedCalls === 1 ? "Does it purr?" : "Does it live in water?";
          this.generatedQuestionYesAnimal = "whale";
          this.generatedQuestionNoAnimal = "cat";
          return {
            question: this.generatedQuestion,
            yesAnimal: this.generatedQuestionYesAnimal,
            noAnimal: this.generatedQuestionNoAnimal,
          };
        },
        validateGeneratedQuestion() {
          this.callLog.push("validate-generated-question");
          if (this.generatedCalls === 1) {
            return "retry";
          }
          return "valid";
        },
      });
      const machine = createGameMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "??");
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        [
          "generate-question:1",
          "validate-generated-question",
          "generate-question:2",
          "validate-generated-question",
        ],
        "Game state machine should retry invalid animal input and retry question generation after a failed validation",
      );
      assertEqual(result.status, "lost", "Game state machine should still end as lost after learning completes through retries");
      assertEqual(context.questionGenerationAttemptCount, 2, "Game state machine should track how many question-generation attempts were used");
      assertEqual(context.userAnimalInput, "whale", "Game state machine should keep the latest submitted animal input in context data");
      assertEqual(context.userAnimalValidationError, null, "Game state machine should clear the validation error after a valid retry");
    }),
  ];
}
