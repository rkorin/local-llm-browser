import { EventIds } from "./event-ids.js";

const DEFAULT_INVALID_ANIMAL_DELAY_MS = 2000;
const TREE_READ_TIMEOUT_MS = 5000;
const TREE_REPLACE_TIMEOUT_MS = 5000;
const MAX_QUESTION_GENERATION_ATTEMPTS = 5;
const WAIT_FOR_USER_ANIMAL_TIMEOUT_MS = 0;
const VALIDATE_ANIMAL_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requireGameContext(context) {
  if (!context) {
    throw new Error("Game state machine requires a context.");
  }
  if (!context.eventBus) {
    throw new Error("Game state machine requires context.eventBus.");
  }
  if (!context.resources) {
    throw new Error("Game state machine requires context.resources.");
  }
}

function invalidAnimalDelayMsOf(context) {
  if (Number.isFinite(context.invalidAnimalDelayMs)) {
    return Math.max(0, Number(context.invalidAnimalDelayMs));
  }
  return DEFAULT_INVALID_ANIMAL_DELAY_MS;
}

function buildTreeReplacePayload(context) {
  return {
    targetNodeId: context.failedAnimalNodeId,
    question: context.generatedQuestion,
    yesAnimalName: context.generatedQuestionYesAnimal,
    noAnimalName: context.generatedQuestionNoAnimal,
  };
}

function normalizeUserAnimalInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isLocallyValidAnimalName(value) {
  if (value.length < 3) {
    return false;
  }

  return /^[a-z][a-z\s-]*[a-z]$/i.test(value);
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getGameStateMachineDefinition(context) {
  requireGameContext(context);

  return {
    id: "game-state-machine",
    startNode: "step-1-start-round",
    errorNode: "finish-invalid",
    endNode: "game-finished",
    context,
    nodes: [
      {
        id: "step-1-start-round",
        provider: async (machineContext, machine) => {
          const rootLoadedEvent = await machine.publishAndReceive(
            EventIds.treeRootReadRequested,
            EventIds.treeRootLoaded,
            "game-state-machine:step-1-start-round",
            null,
            TREE_READ_TIMEOUT_MS,
          );

          machineContext.rootNode = rootLoadedEvent.message;
          machineContext.currentNode = rootLoadedEvent.message;
          machineContext.failedAnimalNodeId = null;
          machineContext.failedAnimalName = null;
          machineContext.userAnimalName = null;
          machineContext.userAnimalInput = null;
          machineContext.userAnimalValidationError = null;
          machineContext.generatedQuestion = null;
          machineContext.generatedQuestionYesAnimal = null;
          machineContext.generatedQuestionNoAnimal = null;
          machineContext.questionGenerationAttemptCount = 0;
          machineContext.generatedQuestionHistory = [];

          return "step-2-decide-current-node-type";
        },
      },
      {
        id: "step-2-decide-current-node-type",
        provider: async (machineContext) => {
          if (machineContext.currentNode.isAnimalNode()) {
            return "step-3-ask-animal-guess";
          }

          return "step-6-ask-branch-question";
        },
      },
      {
        id: "step-3-ask-animal-guess",
        provider: async (machineContext, machine) => {
          const currentNode = machineContext.currentNode;
          const answerEvent = await machine.publishAndReceive(
            EventIds.gameQuestionAsked,
            [EventIds.uiChoiceYes, EventIds.uiChoiceNo],
            "game-state-machine:step-3-ask-animal-guess",
            {
              kind: "yes-no-question",
              role: "game",
              text: `Is it ${currentNode.name}?`,
            },
          );

          if (answerEvent.id === EventIds.uiChoiceYes) {
            return "step-4-save-won-status-for-parent-sm";
          }

          return "step-5-remember-failed-animal-node";
        },
      },
      {
        id: "step-4-save-won-status-for-parent-sm",
        provider: async (machineContext) => {
          machineContext.gameResultForParentSm = "won";
          machineContext.machineResult = "won";
          return "end";
        },
      },
      {
        id: "step-5-remember-failed-animal-node",
        provider: async (machineContext) => {
          const failedAnimalNode = machineContext.currentNode;
          machineContext.failedAnimalNodeId = failedAnimalNode.id;
          machineContext.failedAnimalName = failedAnimalNode.name;
          return "step-7-request-user-animal";
        },
      },
      {
        id: "step-6-ask-branch-question",
        provider: async (machineContext, machine) => {
          const currentNode = machineContext.currentNode;
          const answerEvent = await machine.publishAndReceive(
            EventIds.gameQuestionAsked,
            [EventIds.uiChoiceYes, EventIds.uiChoiceNo],
            "game-state-machine:step-6-ask-branch-question",
            {
              kind: "yes-no-question",
              role: "game",
              text: currentNode.question,
            },
          );

          if (answerEvent.id === EventIds.uiChoiceYes) {
            machineContext.currentNode = currentNode.yesNode;
            return "step-2-decide-current-node-type";
          }

          machineContext.currentNode = currentNode.noNode;
          return "step-2-decide-current-node-type";
        },
      },
      {
        id: "step-7-request-user-animal",
        provider: async (machineContext, machine) => {
          const userAnimalEvent = await machine.waitForEventOnce(
            EventIds.uiAnimalSubmit,
            "game-state-machine:step-7-request-user-animal",
            WAIT_FOR_USER_ANIMAL_TIMEOUT_MS,
          );
          machineContext.userAnimalInput = userAnimalEvent.message;
          return "step-8-validate-user-animal";
        },
      },
      {
        id: "step-8-validate-user-animal",
        provider: async (machineContext, machine) => {
          const normalizedUserAnimalName = normalizeUserAnimalInput(machineContext.userAnimalInput);
          machineContext.userAnimalValidationError = null;

          if (!isLocallyValidAnimalName(normalizedUserAnimalName)) {
            machineContext.userAnimalValidationError = "local-validation-failed";
            return "step-9-report-invalid-animal";
          }

          const validateAnimalPrompt = machineContext.resources.prompts.game.validateAnimalInput(
            machineContext.failedAnimalName,
            normalizedUserAnimalName,
          );

          const responseEvent = await machine.publishAndReceive(
            EventIds.llmRequestRequested,
            [EventIds.llmResponseReceived, EventIds.llmRequestFailed],
            "game-state-machine:step-8-validate-user-animal",
            validateAnimalPrompt,
            VALIDATE_ANIMAL_TIMEOUT_MS,
          );

          if (responseEvent.id === EventIds.llmRequestFailed) {
            machineContext.userAnimalValidationError = "llm-request-failed";
            return "step-9-report-invalid-animal";
          }

          const validationPayload = parseJsonObject(responseEvent.message?.response);
          if (!validationPayload) {
            machineContext.userAnimalValidationError = "model-did-not-return-json";
            return "step-9-report-invalid-animal";
          }

          if (validationPayload.isValid !== true) {
            machineContext.userAnimalValidationError = String(validationPayload.reasonCode || "invalid");
            return "step-9-report-invalid-animal";
          }

          machineContext.userAnimalName = normalizeUserAnimalInput(validationPayload.normalizedAnimal);
          if (!isLocallyValidAnimalName(machineContext.userAnimalName)) {
            machineContext.userAnimalValidationError = "model-returned-invalid-animal-name";
            return "step-9-report-invalid-animal";
          }

          return "step-10-generate-question";
        },
      },
      {
        id: "step-9-report-invalid-animal",
        provider: async (machineContext) => {
          await sleep(invalidAnimalDelayMsOf(machineContext));
          return "step-7-request-user-animal";
        },
      },
      {
        id: "step-10-generate-question",
        provider: async (machineContext) => {
          machineContext.questionGenerationAttemptCount += 1;

          const generatedQuestion = await machineContext.generateDistinguishingQuestion();
          if (generatedQuestion && generatedQuestion.question) {
            machineContext.generatedQuestion = generatedQuestion.question;
            machineContext.generatedQuestionYesAnimal = generatedQuestion.yesAnimal;
            machineContext.generatedQuestionNoAnimal = generatedQuestion.noAnimal;
          }

          if (machineContext.generatedQuestion) {
            machineContext.generatedQuestionHistory.push(machineContext.generatedQuestion);
          }

          return "step-11-validate-generated-question";
        },
      },
      {
        id: "step-11-validate-generated-question",
        provider: async (machineContext) => {
          const validationResult = await machineContext.validateGeneratedQuestion();
          if (validationResult === "valid") {
            return "step-12-save-learned-question";
          }
          if (machineContext.questionGenerationAttemptCount >= MAX_QUESTION_GENERATION_ATTEMPTS) {
            return "finish-lost";
          }
          return "step-10-generate-question";
        },
      },
      {
        id: "step-12-save-learned-question",
        provider: async (machineContext, machine) => {
          const replacePayload = buildTreeReplacePayload(machineContext);
          const treeReplacedEvent = await machine.publishAndReceive(
            EventIds.treeNodeReplaceRequested,
            EventIds.treeNodeReplaced,
            "game-state-machine:step-12-save-learned-question",
            replacePayload,
            TREE_REPLACE_TIMEOUT_MS,
          );

          machineContext.rootNode = treeReplacedEvent.message;
          return "finish-lost";
        },
      },
      {
        id: "finish-lost",
        provider: async (machineContext) => {
          machineContext.gameResultForParentSm = "lost";
          machineContext.machineResult = "lost";
          return "end";
        },
      },
      {
        id: "finish-invalid",
        provider: async (machineContext) => {
          machineContext.gameResultForParentSm = "invalid";
          machineContext.machineResult = "invalid";
          return "end";
        },
      },
      {
        id: "game-finished",
        provider: async () => "done",
        next: { done: null },
      },
    ],
  };
}
