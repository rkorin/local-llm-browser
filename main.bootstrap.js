import { ResourceFactory } from "./resource-factory.js";
import { ProviderFactory } from "./provider-factory.js";
import { TreeNode } from "./model-tree-node.js";
import { TreeRepository } from "./repository-tree.js";
import { EventMessageBus } from "./event-message-bus.js";
import { EventIds } from "./event-ids.js";
import { MainPresenter } from "./presenter-main.js";
import { GamePresenter } from "./presenter-game.js";
import { DebugPanelPresenter } from "./presenter-debug-panel.js";
import { createBootstrapStateMachine } from "./state-machine-bootstrap.js";
import { createGameStateMachine } from "./state-machine-game.js";

const STORAGE_KEY = "animal-question-tree-v1";
const MAX_ANIMAL_INPUT_LENGTH = 30;
const OBVIOUS_PROFANITY = ["fuck", "shit"];

let resourceFactory = null;
let resources = null;
let providerFactory = null;
let llmProviderType = null;
let llmProvider = null;
let treeRepository = null;
let eventMessageBus = null;
let mainPresenter = null;
let gamePresenter = null;
let debugPanelPresenter = null;
let rootNode = null;
let currentPath = [];
let awaitingAnimalForNode = null;
let isDebugReplayRunning = false;
let isDebugVisible = false;
let latestDebugPrompt = "";
let latestAnimalInput = "";
let gameStateMachine = null;
let bootstrapStateMachine = null;

let lastModelDebug = {
  stage: "",
  prompt: "",
  response: "",
};

const statusContext = {
  text: "",
  isError: false,
  progress: 0,
};

const gameContext = {
  visible: false,
  mode: "hidden",
  chat: [],
};

function publishStaticResources() {
  eventMessageBus.publish(EventIds.appStaticResourcesChanged, resources);
}

function publishStatusContext() {
  eventMessageBus.publish(EventIds.appStatusChanged, { ...statusContext });
}

function publishDebugContext() {
  eventMessageBus.publish(EventIds.debugContextChanged, {
    visible: isDebugVisible,
    stage: lastModelDebug.stage,
    prompt: latestDebugPrompt,
    response: lastModelDebug.response,
  });
}

function publishGameContext() {
  eventMessageBus.publish(EventIds.gameContextChanged, {
    visible: gameContext.visible,
    mode: gameContext.mode,
    chat: gameContext.chat.map((item) => ({ ...item })),
  });
}

function setStatus(message) {
  statusContext.text = String(message);
  statusContext.isError = false;
  publishStatusContext();
}

function setProgress(value) {
  statusContext.progress = Math.max(0, Math.min(100, value));
  publishStatusContext();
}

function setError(message) {
  statusContext.text = String(message);
  statusContext.isError = true;
  publishStatusContext();
}

function clearError() {
  statusContext.isError = false;
  publishStatusContext();
}

function renderDebugPanel() {
  publishDebugContext();
}

function recordModelDebug(stage, prompt, response) {
  latestDebugPrompt = String(prompt);
  lastModelDebug = {
    stage: String(stage),
    prompt: String(prompt),
    response: String(response),
  };
  publishDebugContext();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function debugStageName(stageKey) {
  return resources.debug.stages[stageKey] || stageKey;
}

function isProviderReady() {
  return typeof llmProvider.isReady === "function" && llmProvider.isReady();
}

async function runModelCall(stage, prompt) {
  if (!isProviderReady()) {
    throw new Error(resources.errors.modelEngineNotReady);
  }

  try {
    const responseText = await llmProvider.complete(prompt);
    recordModelDebug(stage, prompt, responseText || resources.debug.emptyResponse);
    return responseText;
  } catch (error) {
    recordModelDebug(stage, prompt, `ERROR: ${errorMessage(error)}`);
    throw error;
  }
}

async function rerunDebugPrompt() {
  if (isDebugReplayRunning) {
    return;
  }

  const prompt = String(latestDebugPrompt || "").trim();
  if (!prompt) {
    setStatus(resources.debug.promptEmpty);
    return;
  }
  if (!isProviderReady()) {
    setStatus(resources.debug.engineNotReady);
    return;
  }

  isDebugReplayRunning = true;
  setStatus(resources.debug.runningEditedPrompt);

  try {
    await runModelCall(`${lastModelDebug.stage} (${resources.debug.stages.debugReplaySuffix})`, prompt);
    setStatus(resources.debug.editedPromptCompleted);
  } catch (error) {
    setStatus(resources.debug.promptFailed(errorMessage(error)));
  } finally {
    isDebugReplayRunning = false;
  }
}

function addBubble(role, message) {
  gameContext.chat.push({ role, message: String(message) });
  publishGameContext();
}

function addGameMessage(message) {
  addBubble("game", message);
}

function addUserMessage(message) {
  addBubble("user", message);
}

function resetChat() {
  gameContext.chat = [];
  publishGameContext();
}

function showChoices() {
  gameContext.visible = true;
  gameContext.mode = "choice";
  publishGameContext();
}

function showAnimalInput() {
  gameContext.visible = true;
  gameContext.mode = "input";
  publishGameContext();
}

function showRestartButton() {
  gameContext.visible = true;
  gameContext.mode = "restart";
  publishGameContext();
}

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function animalLabel(animal) {
  return `${articleFor(animal)} ${animal}`;
}

function createDefaultTree() {
  return TreeNode.createDefault();
}

function loadTree() {
  eventMessageBus.publish(EventIds.treeRootReadRequested, null);
}

function saveTree() {
  eventMessageBus.publish(EventIds.treeRootSaveRequested, rootNode);
}

function resetKnowledgeTree() {
  eventMessageBus.publish(EventIds.treeRootResetRequested, null);
  awaitingAnimalForNode = null;
  currentPath = [];
  setStatus(resources.status.savedTreeReset);
  resetChat();
  if (gameContext.visible) {
    addGameMessage(resources.game.localKnowledgeBaseReset);
  }
}

function getNodeAtPath(path) {
  return rootNode.getNodeByPath(path);
}

function replaceNodeAtPath(path, nextNode) {
  rootNode = rootNode.replaceNodeByPath(path, nextNode);
  saveTree();
}

function normalizeQuestion(text) {
  const firstLine = String(text ?? "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .split(/\r?\n/)[0]
    .trim();
  if (!firstLine) {
    return "";
  }
  return firstLine.endsWith("?") ? firstLine : `${firstLine}?`;
}

function normalizeAnimalName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sanitizeUserAnimalInput(value) {
  return String(value ?? "").trim();
}

function isPrompt0ResultConsistentWithInput(userInput, canonicalAnimal, displayAnimal) {
  const rawInput = normalizeAnimalName(userInput);
  const normalizedCanonical = normalizeAnimalName(canonicalAnimal);
  const normalizedDisplay = normalizeAnimalName(displayAnimal);
  return Boolean(rawInput) && (normalizedDisplay === rawInput || normalizedCanonical === rawInput);
}

function detectLocalInvalidAnimalInput(value) {
  const trimmed = sanitizeUserAnimalInput(value);
  const normalized = normalizeAnimalName(trimmed);

  if (!trimmed) {
    return { isValidAnimal: false, reasonCode: "empty" };
  }
  if (OBVIOUS_PROFANITY.some((word) => normalized.includes(word))) {
    return { isValidAnimal: false, reasonCode: "profanity" };
  }
  if (!/^[A-Za-z\s-]+$/.test(trimmed)) {
    return { isValidAnimal: false, reasonCode: "english_only" };
  }
  if (/[0-9]/.test(trimmed)) {
    return { isValidAnimal: false, reasonCode: "blocked_or_invalid" };
  }
  if (trimmed.length > MAX_ANIMAL_INPUT_LENGTH || trimmed.split(/\s+/).length > 3) {
    return { isValidAnimal: false, reasonCode: "unclear" };
  }

  return { isValidAnimal: true, reasonCode: "valid" };
}

function canUseSimpleAnimalFallback(value) {
  const trimmed = sanitizeUserAnimalInput(value);
  const normalized = normalizeAnimalName(trimmed);
  if (!trimmed || trimmed.includes(" ") || !/^[A-Za-z-]+$/.test(trimmed)) {
    return false;
  }
  if (normalized.length < 2 || normalized.length > 20 || normalized === "animal") {
    return false;
  }
  return !OBVIOUS_PROFANITY.some((word) => normalized.includes(word));
}

function invalidAnimalMessage(reasonCode) {
  return resources.reasonMessages[reasonCode] || resources.reasonMessages.default;
}

function extractJsonObject(text) {
  const rawText = String(text ?? "").trim();
  const startIndex = rawText.indexOf("{");
  const endIndex = rawText.lastIndexOf("}");
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(resources.errors.modelDidNotReturnJson);
  }
  return rawText.slice(startIndex, endIndex + 1);
}

function extractYesNoAnswer(text) {
  const normalized = String(text ?? "").trim().toUpperCase();
  if (normalized === "YES" || normalized.startsWith("YES\n")) {
    return true;
  }
  if (normalized === "NO" || normalized.startsWith("NO\n")) {
    return false;
  }
  throw new Error(resources.errors.modelDidNotReturnYesNo);
}

function generateFallbackQuestion(knownAnimal, newAnimal) {
  return {
    question: resources.game.guessedAnimalQuestion(animalLabel(knownAnimal)),
    yesAnimal: knownAnimal,
    noAnimal: newAnimal,
  };
}

async function generateQuestionForAnimals(knownAnimal, newAnimal) {
  if (!isProviderReady()) {
    return generateFallbackQuestion(knownAnimal, newAnimal);
  }

  const prompt = resources.prompts.generateQuestion(knownAnimal, newAnimal);
  const content = await runModelCall(debugStageName("prompt1GenerateQuestion"), prompt);
  const parsed = JSON.parse(extractJsonObject(content));
  const question = normalizeQuestion(parsed?.question);
  const yesAnimal = normalizeAnimalName(parsed?.yesAnimal);
  const noAnimal = normalizeAnimalName(parsed?.noAnimal);
  const allowedAnimals = new Set([normalizeAnimalName(knownAnimal), normalizeAnimalName(newAnimal)]);

  if (!question) {
    throw new Error(resources.errors.modelReturnedEmptyQuestion);
  }
  if (!allowedAnimals.has(yesAnimal) || !allowedAnimals.has(noAnimal)) {
    throw new Error(resources.errors.modelReturnedUnexpectedAnimals);
  }
  if (yesAnimal === noAnimal) {
    throw new Error(resources.errors.modelReturnedSameAnimals);
  }

  return { question, yesAnimal, noAnimal };
}

async function validateGeneratedQuestion(knownAnimal, newAnimal, candidate) {
  if (!isProviderReady()) {
    return {
      isValid: true,
      question: candidate.question,
      yesAnimal: candidate.yesAnimal,
      noAnimal: candidate.noAnimal,
    };
  }

  const prompt = resources.prompts.validateQuestion(knownAnimal, newAnimal);
  const content = await runModelCall(debugStageName("prompt2ValidateQuestion"), prompt);
  const question = normalizeQuestion(content);

  if (!question) {
    throw new Error(resources.errors.validatorReturnedEmptyQuestion);
  }

  return {
    isValid: true,
    question,
    yesAnimal: normalizeAnimalName(knownAnimal),
    noAnimal: normalizeAnimalName(newAnimal),
  };
}

async function normalizeAnimalMatch(guessedAnimal, userAnimal) {
  const guessedNormalized = normalizeAnimalName(guessedAnimal);
  const userNormalized = normalizeAnimalName(userAnimal);

  if (guessedNormalized === userNormalized) {
    return {
      sameAnimal: true,
      canonicalAnimal: guessedNormalized,
      guessedNormalized,
      userNormalized,
    };
  }

  if (!isProviderReady()) {
    return {
      sameAnimal: false,
      canonicalAnimal: null,
      guessedNormalized,
      userNormalized,
    };
  }

  const prompt = resources.prompts.sameAnimalCheck(guessedAnimal, userAnimal);
  const content = await runModelCall(debugStageName("prompt15SameAnimalCheck"), prompt);
  const sameAnimal = extractYesNoAnswer(content);

  return {
    sameAnimal,
    canonicalAnimal: sameAnimal ? guessedNormalized : null,
    guessedNormalized,
    userNormalized,
  };
}

async function validateAnimalInput(userInput) {
  const localCheck = detectLocalInvalidAnimalInput(userInput);
  if (!localCheck.isValidAnimal) {
    const mappedReasonCode = localCheck.reasonCode === "not_an_animal"
      ? "not_an_animal"
      : (localCheck.reasonCode === "english_only" ? "english_only" : "blocked_or_invalid");
    return {
      isValidAnimal: false,
      canonicalAnimal: null,
      displayAnimal: null,
      reasonCode: mappedReasonCode,
    };
  }

  if (!isProviderReady()) {
    const normalized = normalizeAnimalName(userInput);
    return {
      isValidAnimal: true,
      canonicalAnimal: normalized,
      displayAnimal: sanitizeUserAnimalInput(userInput),
      reasonCode: "valid",
    };
  }

  const prompt = resources.prompts.validateAnimalInput(sanitizeUserAnimalInput(userInput));
  const content = await runModelCall(debugStageName("prompt0ValidateAnimalInput"), prompt);
  const isValidAnimal = extractYesNoAnswer(content);
  const cleanedInput = sanitizeUserAnimalInput(userInput);
  const canonicalAnimal = normalizeAnimalName(userInput);

  return {
    isValidAnimal,
    canonicalAnimal: isValidAnimal ? canonicalAnimal : null,
    displayAnimal: isValidAnimal ? cleanedInput : null,
    reasonCode: isValidAnimal ? "valid" : "not_an_animal",
  };
}

async function verifyModelResponse() {
  if (!isProviderReady()) {
    throw new Error(resources.errors.modelEngineNotReady);
  }

  const content = await runModelCall(debugStageName("healthCheck"), resources.prompts.healthcheck);
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(resources.errors.modelReturnedEmptyHelloResponse);
  }
}

function renderCurrentNodeState() {
  const node = getNodeAtPath(currentPath);
  gameContext.visible = true;

  if (node?.isQuestionNode()) {
    addGameMessage(node.question);
    showChoices();
    return "choice";
  }

  if (node?.isAnimalNode()) {
    addGameMessage(resources.game.guessedAnimalQuestion(animalLabel(node.name)));
    showChoices();
    return "choice";
  }

  addGameMessage(resources.game.savedTreeInvalid);
  gameContext.mode = "hidden";
  publishGameContext();
  return "invalid";
}

function startRoundState() {
  awaitingAnimalForNode = null;
  currentPath = [];
  resetChat();
  setStatus(resources.status.modelReadyThinkAnimal);
}

function prepareAnimalInput() {
  showAnimalInput();
}

async function handleYesAction() {
  addUserMessage(resources.game.userYes);
  const node = getNodeAtPath(currentPath);
  if (node?.isQuestionNode()) {
    currentPath = [...currentPath, "yes"];
    return "render";
  }

  if (node?.isAnimalNode()) {
    addGameMessage(resources.game.guessedIt(animalLabel(node.name)));
    showRestartButton();
    return "won";
  }

  return "default";
}

async function handleNoAction() {
  addUserMessage(resources.game.userNo);
  const node = getNodeAtPath(currentPath);
  if (node?.isQuestionNode()) {
    currentPath = [...currentPath, "no"];
    return "render";
  }

  if (node?.isAnimalNode()) {
    awaitingAnimalForNode = { node, path: [...currentPath] };
    addGameMessage(resources.game.unknownAnimalLost);
    addGameMessage(resources.game.typeChosenAnimal);
    return "ask_animal";
  }

  return "default";
}

async function handleAnimalSubmitAction() {
  if (!awaitingAnimalForNode) {
    return "default";
  }

  const newAnimal = normalizeAnimalName(latestAnimalInput);
  const validation = await validateAnimalInput(newAnimal).catch(() => {
    if (canUseSimpleAnimalFallback(newAnimal)) {
      return {
        isValidAnimal: true,
        canonicalAnimal: normalizeAnimalName(newAnimal),
        displayAnimal: sanitizeUserAnimalInput(newAnimal),
        reasonCode: "valid",
      };
    }

    return {
      isValidAnimal: false,
      canonicalAnimal: null,
      displayAnimal: null,
      reasonCode: detectLocalInvalidAnimalInput(newAnimal).reasonCode || "unclear",
    };
  });

  if (
    validation.isValidAnimal
    && validation.canonicalAnimal
    && !isPrompt0ResultConsistentWithInput(newAnimal, validation.canonicalAnimal, validation.displayAnimal)
  ) {
    addUserMessage(sanitizeUserAnimalInput(newAnimal) || "...");
    setStatus(resources.status.inconsistentAnimalNormalization);
    addGameMessage(resources.game.inconsistentAnswer);
    return "retry";
  }

  if (!validation.isValidAnimal || !validation.canonicalAnimal) {
    addUserMessage(sanitizeUserAnimalInput(newAnimal) || "...");
    setStatus(resources.status.inputRejected);
    addGameMessage(invalidAnimalMessage(validation.reasonCode));
    return "retry";
  }

  const knownAnimal = awaitingAnimalForNode.node.name;
  const displayAnimal = validation.displayAnimal || sanitizeUserAnimalInput(newAnimal);
  const canonicalNewAnimal = validation.canonicalAnimal;
  let sameAnimalResult;
  try {
    sameAnimalResult = await normalizeAnimalMatch(knownAnimal, displayAnimal);
  } catch {
    sameAnimalResult = {
      sameAnimal: normalizeAnimalName(knownAnimal) === normalizeAnimalName(displayAnimal),
      canonicalAnimal: null,
      guessedNormalized: normalizeAnimalName(knownAnimal),
      userNormalized: normalizeAnimalName(displayAnimal),
    };
  }

  if (sameAnimalResult.sameAnimal) {
    addUserMessage(displayAnimal);
    const canonicalAnimal = sameAnimalResult.canonicalAnimal || normalizeAnimalName(knownAnimal);
    if (canonicalAnimal) {
      replaceNodeAtPath(awaitingAnimalForNode.path, new TreeNode({ name: canonicalAnimal }));
    }
    awaitingAnimalForNode = null;
    setStatus(resources.status.sameAnimalDetected);
    addGameMessage(resources.game.sameAnimalCounts);
    showRestartButton();
    return "won";
  }

  addUserMessage(displayAnimal);
  setStatus(resources.status.learningHowToDistinguish(knownAnimal, canonicalNewAnimal));
  gameContext.mode = "hidden";
  publishGameContext();
  addGameMessage(resources.game.savingNewQuestion);

  let mapping;
  try {
    mapping = await generateQuestionForAnimals(knownAnimal, canonicalNewAnimal);
    mapping = await validateGeneratedQuestion(knownAnimal, canonicalNewAnimal, mapping);
  } catch (error) {
    mapping = generateFallbackQuestion(knownAnimal, canonicalNewAnimal);
    setStatus(resources.status.fallbackQuestionUsed(errorMessage(error)));
  }

  replaceNodeAtPath(
    awaitingAnimalForNode.path,
    new TreeNode({
      question: mapping.question,
      yesNode: new TreeNode({ name: mapping.yesAnimal }),
      noNode: new TreeNode({ name: mapping.noAnimal }),
    }),
  );

  awaitingAnimalForNode = null;
  setStatus(resources.status.savedToLocalStorage);
  addGameMessage(resources.game.savedNewQuestion(mapping.question));
  showRestartButton();
  return "lost";
}

function bindBusSubscriptions() {
  eventMessageBus.subscribe("all", "main-bootstrap:bindings", (event) => {
    if (event.id === EventIds.treeRootLoaded) {
      rootNode = event.message;
      return;
    }

    if (event.id === EventIds.uiRestartRequested) {
      restartGameRound();
      return;
    }

    if (event.id === EventIds.uiResetTreeRequested) {
      resetKnowledgeTree();
      restartGameRound();
      return;
    }

    if (event.id === EventIds.uiDebugToggleRequested) {
      isDebugVisible = !isDebugVisible;
      publishDebugContext();
      return;
    }

    if (event.id === EventIds.uiDebugRerunRequested) {
      latestDebugPrompt = String(event.message ?? latestDebugPrompt);
      bootstrapStateMachine.run("rerun-debug-prompt");
      return;
    }

    if (event.id === EventIds.uiLanguageChanged) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("lang", String(event.message || resources.locale));
      window.location.href = nextUrl.toString();
      return;
    }

    if (event.id === EventIds.uiAnimalSubmit) {
      latestAnimalInput = String(event.message ?? "");
    }
  });
}

async function performLlmProviderInitialization() {
  const providerLabel = resources.providers.labels[llmProviderType] || resources.providers.labels.local;
  setStatus(resources.providers.status.loading(providerLabel));
  setProgress(8);

  await llmProvider.initialize({
    onProgress: (progress) => {
      const text = progress?.text ?? resources.status.loadingFallback;
      const percent = progress?.progress;
      if (typeof percent === "number") {
        setProgress(Math.round(percent * 100));
      }
      setStatus(text);
    },
  });

  setStatus(resources.status.modelLoaded);
  setProgress(100);
}

function restartGameRound() {
  eventMessageBus.publish(EventIds.gameCancel, null);
  gameStateMachine.stop();
  Promise.resolve().then(() => {
    gameStateMachine.run();
  });
}
 
 
