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
      eventBus,
      question: message.question,
      yesNode: new TreeNode({ eventBus, name: message.yesAnimalName }),
      noNode: new TreeNode({ eventBus, name: message.noAnimalName }),
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

    if (prompt.includes("PREVIOUS_QUESTIONS")) {
      if (typeof overrides.handleGenerateQuestionPrompt === "function") {
        overrides.handleGenerateQuestionPrompt(prompt, eventBus);
        return;
      }

      eventBus.publish(EventIds.llmResponseReceived, {
        providerType: "echo",
        prompt,
        response: JSON.stringify({
          question: "Does it live in water?",
          yesAnimal: "whale",
          noAnimal: "cat",
        }),
      });
      return;
    }

    if (prompt.includes("CANDIDATE_QUESTION")) {
      if (typeof overrides.handleValidateGeneratedQuestionPrompt === "function") {
        overrides.handleValidateGeneratedQuestionPrompt(prompt, eventBus);
        return;
      }

      eventBus.publish(EventIds.llmResponseReceived, {
        providerType: "echo",
        prompt,
        response: JSON.stringify({
          isValid: true,
          normalizedQuestion: "Does it live in water?",
          yesAnimal: "whale",
          noAnimal: "cat",
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
  const rootNode = overrides.rootNode || new TreeNode({ eventBus, name: "cat" });
  wireTreeRepositoryMock(eventBus, rootNode);
  wireLlmMock(eventBus, overrides);

  return {
    callLog,
    eventBus,
    resources: {
      prompts: {
        game: {
          validateAnimalInput: (failedAnimalName, userInput) => `FAILED_ANIMAL_NAME=${failedAnimalName}; USER_INPUT=${userInput}`,
          generateDistinguishingQuestion: (failedAnimalName, userAnimalName, previousQuestionsJson) => `FAILED_ANIMAL_NAME=${failedAnimalName}; NEW_ANIMAL_NAME=${userAnimalName}; PREVIOUS_QUESTIONS=${previousQuestionsJson}`,
          validateGeneratedQuestion: (failedAnimalName, userAnimalName, candidateQuestion, yesAnimal, noAnimal) => `FAILED_ANIMAL_NAME=${failedAnimalName}; NEW_ANIMAL_NAME=${userAnimalName}; CANDIDATE_QUESTION=${candidateQuestion}; YES_ANIMAL=${yesAnimal}; NO_ANIMAL=${noAnimal}`,
        },
      },
    },
    rootNode: null,
    currentNode: null,
    invalidAnimalDelayMs: 0,


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
      assertEqual(result.context.currentNode.name, "cat", "Game state machine should keep the current node on the guessed animal when the answer is yes");
      assertEqual(result.context.gameResultForParentSm, "won", "Game state machine should store the won result for the parent state machine");
    }),

    runTest("state-machine-game-002 question branch can traverse and then learn a new animal", async () => {
      const eventBus = new EventMessageBus();
      const rootNode = new TreeNode({
        eventBus,
        question: "Does it fly?",
        yesNode: new TreeNode({ eventBus, name: "eagle" }),
        noNode: new TreeNode({ eventBus, name: "cat" }),
      });
      const context = createGameContext({ eventBus, rootNode });
      const machine = createGameMachine(context);
      const published = [];
      context.eventBus.subscribe("all", "test:game-events:002", (event) => {
        published.push(event);
      });
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
        [],
        "Game state machine should traverse a question node, validate the animal, and continue learning",
      );
      const generationRequests = published.filter((event) =>
        event.id === EventIds.llmRequestRequested && String(event.message).includes("PREVIOUS_QUESTIONS"),
      );
      assertEqual(generationRequests.length, 1, "Step 10 should publish exactly one distinguishing-question prompt");
      assertEqual(
        generationRequests[0].message,
        'FAILED_ANIMAL_NAME=cat; NEW_ANIMAL_NAME=whale; PREVIOUS_QUESTIONS=[]',
        "Step 10 should ask the model to distinguish the failed current-node animal from the user animal",
      );
      const validationRequests = published.filter((event) =>
        event.id === EventIds.llmRequestRequested && String(event.message).includes("CANDIDATE_QUESTION"),
      );
      assertEqual(validationRequests.length, 1, "Step 11 should publish exactly one generated-question validation prompt");
      assertEqual(
        validationRequests[0].message,
        'FAILED_ANIMAL_NAME=cat; NEW_ANIMAL_NAME=whale; CANDIDATE_QUESTION=Does it live in water?; YES_ANIMAL=whale; NO_ANIMAL=cat',
        "Step 11 should double-check the question and its yes/no animal mapping",
      );
      assertEqual(result.status, "lost", "Game state machine should end with lost status after learning a new animal");
      assertEqual(result.context.failedAnimalNodeId, rootNode.noNode.id, "Game state machine should remember the failed animal runtime id for learning");
      assertEqual(result.context.userAnimalInput, "whale", "Game state machine should store the user animal input at step 7");
      assertEqual(result.context.userAnimalName, "whale", "Game state machine should store the normalized user animal name after step 8");
      assertEqual(result.context.rootNode.question, "Does it live in water?", "Game state machine should keep the replaced root from the repository response");
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
        const runPromise = machine.run();
        await waitForMicrotask();
        context.eventBus.publish(EventIds.uiChoiceNo, null);
        await runPromise;
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "Cannot read properties of undefined (reading 'isAnimalNode')", "Game state machine should fail loudly when root node does not respect the TreeNode contract");
      assertArrayEqual(
        context.callLog,
        [],
        "Game state machine should not ask gameplay questions when the root node is structurally invalid",
      );
    }),

    runTest("state-machine-game-004 invalid animal input loops back to step 7 before succeeding", async () => {
      let validateAnimalCalls = 0;
      let generatedQuestionCalls = 0;
      const context = createGameContext({
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
        handleGenerateQuestionPrompt(prompt, eventBus) {
          generatedQuestionCalls += 1;
          eventBus.publish(EventIds.llmResponseReceived, {
            providerType: "echo",
            prompt,
            response: JSON.stringify({
              question: generatedQuestionCalls === 1 ? "Does it purr?" : "Does it live in water?",
              yesAnimal: "whale",
              noAnimal: "cat",
            }),
          });
        },
        handleValidateGeneratedQuestionPrompt(prompt, eventBus) {
          const isValid = generatedQuestionCalls > 1;
          eventBus.publish(EventIds.llmResponseReceived, {
            providerType: "echo",
            prompt,
            response: JSON.stringify({
              isValid: true,
              normalizedQuestion: isValid ? "Does it live in water?" : "Does it purr?",
              yesAnimal: isValid ? "whale" : "dog",
              noAnimal: "cat",
              reasonCode: "valid",
            }),
          });
        },
      });
      const machine = createGameMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      const returnedToAnimalInput = new Promise((resolve) => {
        const unsubscribe = context.eventBus.subscribe(
          EventIds.stateMachineTransitioned,
          "test:animal-retry-transition:004",
          (event) => {
            if (
              event.message?.previousNodeId === "step-9-report-invalid-animal"
              && event.message?.currentNodeId === "step-7-request-user-animal"
            ) {
              unsubscribe();
              resolve();
            }
          },
        );
      });
      context.eventBus.publish(EventIds.uiAnimalSubmit, "dragon");
      await returnedToAnimalInput;
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      assertArrayEqual(
        context.callLog,
        [],
        "Game state machine should retry invalid animal input and retry question generation after a failed validation",
      );
      assertEqual(result.status, "lost", "Game state machine should still end as lost after learning completes through retries");
      assertEqual(result.context.questionGenerationAttemptCount, 2, "Game state machine should track how many question-generation attempts were used");
      assertEqual(result.context.userAnimalInput, "whale", "Game state machine should keep the latest submitted animal input in context data");
      assertEqual(result.context.userAnimalValidationError, null, "Game state machine should clear the animal validation error after a valid retry");
      assertEqual(result.context.generatedQuestionValidationError, null, "Step 11 should clear the question validation error after a valid retry");
      assertArrayEqual(
        result.context.generatedQuestionHistory,
        ["Does it purr?", "Does it live in water?"],
        "Step 10 should retain rejected questions so later prompts can avoid generating them again",
      );
    }),

    runTest("state-machine-game-005 five invalid generated questions finish without saving", async () => {
      let generatedQuestionCalls = 0;
      const published = [];
      const context = createGameContext({
        handleGenerateQuestionPrompt(prompt, eventBus) {
          generatedQuestionCalls += 1;
          eventBus.publish(EventIds.llmResponseReceived, {
            providerType: "echo",
            prompt,
            response: JSON.stringify({
              question: `Question ${generatedQuestionCalls}?`,
              yesAnimal: "whale",
              noAnimal: "cat",
            }),
          });
        },
        handleValidateGeneratedQuestionPrompt(prompt, eventBus) {
          eventBus.publish(EventIds.llmResponseReceived, {
            providerType: "echo",
            prompt,
            response: JSON.stringify({
              isValid: false,
              normalizedQuestion: "",
              yesAnimal: "whale",
              noAnimal: "cat",
              reasonCode: "does-not-distinguish",
            }),
          });
        },
      });
      context.eventBus.subscribe("all", "test:game-events:005", (event) => {
        published.push(event);
      });
      const machine = createGameMachine(context);
      const runPromise = machine.run();

      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiChoiceNo, null);
      await waitForMicrotask();
      context.eventBus.publish(EventIds.uiAnimalSubmit, "whale");
      const result = await runPromise;

      const generationRequests = published.filter((event) =>
        event.id === EventIds.llmRequestRequested && String(event.message).includes("PREVIOUS_QUESTIONS"),
      );
      const validationRequests = published.filter((event) =>
        event.id === EventIds.llmRequestRequested && String(event.message).includes("CANDIDATE_QUESTION"),
      );
      const saveRequests = published.filter((event) => event.id === EventIds.treeNodeReplaceRequested);

      assertEqual(result.status, "lost", "Five invalid generated questions should finish the game as lost");
      assertEqual(result.context.questionGenerationAttemptCount, 5, "Step 11 should stop after five generation attempts");
      assertEqual(generationRequests.length, 5, "The model should generate at most five candidate questions");
      assertEqual(validationRequests.length, 5, "Step 11 should validate every generated candidate");
      assertEqual(saveRequests.length, 0, "Step 12 should not run when all five candidates are invalid");
      assertArrayEqual(
        result.context.generatedQuestionHistory,
        ["Question 1?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"],
        "All attempted questions should remain in context history",
      );
      assertEqual(
        generationRequests[4].message,
        'FAILED_ANIMAL_NAME=cat; NEW_ANIMAL_NAME=whale; PREVIOUS_QUESTIONS=["Question 1?","Question 2?","Question 3?","Question 4?"]',
        "The fifth generation prompt should contain all four previously rejected questions",
      );
    }),
  ];
}
