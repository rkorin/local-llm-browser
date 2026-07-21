import { EventIds } from "./event-ids.js";

/**
 * Game state-machine event contract.
 *
 * Accepts / subscribes to:
 * - tree-root-loaded after requesting the current decision-tree root;
 * - ui-choice-yes and ui-choice-no while asking animal or branch questions;
 * - ui-animal-submit while waiting for the animal the user chose;
 * - llm-response-received and llm-request-failed while validating an animal
 *   or generating or validating a distinguishing question;
 * - tree-node-replaced after saving a learned question.
 *
 * Emits / publishes:
 * - tree-root-read-requested to load the decision tree;
 * - game-question-asked only for the user-visible yes/no prompts at steps 3 and 6;
 * - llm-request-requested for animal validation and distinguishing-question generation/validation;
 * - tree-node-replace-requested to persist a learned question and its branches.
 * - state-machine-transitioned is published automatically by the base StateMachine before every node.
 */
const DEFAULT_INVALID_ANIMAL_DELAY_MS = 2000;
const TREE_READ_TIMEOUT_MS = 5000;
const TREE_REPLACE_TIMEOUT_MS = 5000;
const MAX_QUESTION_GENERATION_ATTEMPTS = 5;
const WAIT_FOR_USER_CHOICE_TIMEOUT_MS = 0;
const WAIT_FOR_USER_ANIMAL_TIMEOUT_MS = 0;
const VALIDATE_ANIMAL_TIMEOUT_MS = 60000;
const GENERATE_QUESTION_TIMEOUT_MS = 60000;
const VALIDATE_GENERATED_QUESTION_TIMEOUT_MS = 60000;

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

function animalGuessQuestionOf(resources, animalLabel) {
  return resources?.game?.messages?.animalGuessQuestion?.(animalLabel)
    || `Is it ${animalLabel}?`;
}

function branchQuestionTextOf(resources, questionText) {
  const normalizedQuestion = String(questionText || "").trim();
  if (normalizedQuestion) {
    return normalizedQuestion;
  }

  return resources?.game?.messages?.branchQuestionFallback
    || "Answer yes or no.";
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
              text: animalGuessQuestionOf(machineContext.resources, currentNode.name),
            },
            WAIT_FOR_USER_CHOICE_TIMEOUT_MS,
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
              text: branchQuestionTextOf(machineContext.resources, currentNode.question),
            },
            WAIT_FOR_USER_CHOICE_TIMEOUT_MS,
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
        provider: async (machineContext, machine) => {
          machineContext.questionGenerationAttemptCount += 1;
          machineContext.generatedQuestion = null;
          machineContext.generatedQuestionYesAnimal = null;
          machineContext.generatedQuestionNoAnimal = null;

          const generateQuestionPrompt = machineContext.resources.prompts.game.generateDistinguishingQuestion(
            machineContext.failedAnimalName,
            machineContext.userAnimalName,
            JSON.stringify(machineContext.generatedQuestionHistory),
          );

          const responseEvent = await machine.publishAndReceive(
            EventIds.llmRequestRequested,
            [EventIds.llmResponseReceived, EventIds.llmRequestFailed],
            "game-state-machine:step-10-generate-question",
            generateQuestionPrompt,
            GENERATE_QUESTION_TIMEOUT_MS,
          );

          if (responseEvent.id === EventIds.llmResponseReceived) {
            const generatedQuestion = parseJsonObject(responseEvent.message?.response);
            if (generatedQuestion) {
              machineContext.generatedQuestion = String(generatedQuestion.question || "").trim() || null;
              machineContext.generatedQuestionYesAnimal = normalizeUserAnimalInput(generatedQuestion.yesAnimal) || null;
              machineContext.generatedQuestionNoAnimal = normalizeUserAnimalInput(generatedQuestion.noAnimal) || null;
            }
          }

          if (machineContext.generatedQuestion) {
            machineContext.generatedQuestionHistory.push(machineContext.generatedQuestion);
          }

          return "step-11-validate-generated-question";
        },
      },
      {
        id: "step-11-validate-generated-question",
        provider: async (machineContext, machine) => {
          machineContext.generatedQuestionValidationError = null;

          if (
            !machineContext.generatedQuestion
            || !machineContext.generatedQuestionYesAnimal
            || !machineContext.generatedQuestionNoAnimal
          ) {
            machineContext.generatedQuestionValidationError = "missing-generated-question-data";
          } else {
            const validateQuestionPrompt = machineContext.resources.prompts.game.validateGeneratedQuestion(
              machineContext.failedAnimalName,
              machineContext.userAnimalName,
              machineContext.generatedQuestion,
              machineContext.generatedQuestionYesAnimal,
              machineContext.generatedQuestionNoAnimal,
            );

            const responseEvent = await machine.publishAndReceive(
              EventIds.llmRequestRequested,
              [EventIds.llmResponseReceived, EventIds.llmRequestFailed],
              "game-state-machine:step-11-validate-generated-question",
              validateQuestionPrompt,
              VALIDATE_GENERATED_QUESTION_TIMEOUT_MS,
            );

            if (responseEvent.id === EventIds.llmRequestFailed) {
              machineContext.generatedQuestionValidationError = "llm-request-failed";
            } else {
              const validationPayload = parseJsonObject(responseEvent.message?.response);
              if (!validationPayload) {
                machineContext.generatedQuestionValidationError = "model-did-not-return-json";
              } else if (validationPayload.isValid !== true) {
                machineContext.generatedQuestionValidationError = String(validationPayload.reasonCode || "invalid");
              } else {
                const normalizedQuestion = String(validationPayload.normalizedQuestion || "").trim();
                const yesAnimal = normalizeUserAnimalInput(validationPayload.yesAnimal);
                const noAnimal = normalizeUserAnimalInput(validationPayload.noAnimal);
                const expectedAnimals = [
                  normalizeUserAnimalInput(machineContext.failedAnimalName),
                  normalizeUserAnimalInput(machineContext.userAnimalName),
                ].sort();
                const validatedAnimals = [yesAnimal, noAnimal].sort();

                if (!normalizedQuestion) {
                  machineContext.generatedQuestionValidationError = "validator-returned-empty-question";
                } else if (yesAnimal === noAnimal) {
                  machineContext.generatedQuestionValidationError = "validator-returned-same-animals";
                } else if (JSON.stringify(validatedAnimals) !== JSON.stringify(expectedAnimals)) {
                  machineContext.generatedQuestionValidationError = "validator-returned-unexpected-animals";
                } else {
                  machineContext.generatedQuestion = normalizedQuestion;
                  machineContext.generatedQuestionYesAnimal = yesAnimal;
                  machineContext.generatedQuestionNoAnimal = noAnimal;
                  return "step-12-save-learned-question";
                }
              }
            }
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
