import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

export const GAME_PRESENTER_ROOT_ID = "game-panel";
const GAME_MACHINE_ID = "game-state-machine";
const STEP_START_ROUND = "step-1-start-round";
const STEP_DECIDE_CURRENT_NODE_TYPE = "step-2-decide-current-node-type";
const STEP_REQUEST_USER_ANIMAL = "step-7-request-user-animal";
const STEP_VALIDATE_USER_ANIMAL = "step-8-validate-user-animal";
const STEP_REPORT_INVALID_ANIMAL = "step-9-report-invalid-animal";
const STEP_GENERATE_QUESTION = "step-10-generate-question";
const STEP_VALIDATE_GENERATED_QUESTION = "step-11-validate-generated-question";
const STEP_SAVE_LEARNED_QUESTION = "step-12-save-learned-question";
const SCREEN_HIDDEN = "hidden";
const SCREEN_START = "start";
const SCREEN_ROUTING = "routing";
const SCREEN_CHOICE = "choice";
const SCREEN_INPUT = "input";
const SCREEN_VALIDATING_ANIMAL = "validating-animal";
const SCREEN_INVALID_ANIMAL_FEEDBACK = "invalid-animal-feedback";
const SCREEN_GENERATING_QUESTION = "generating-question";
const SCREEN_VALIDATING_QUESTION = "validating-question";
const SCREEN_SAVING_LEARNING = "saving-learning";
const SCREEN_LIFECYCLE_PENDING = "lifecycle-pending";
const SCREEN_ERROR = "error";
const SCREEN_RESTART = "restart";
const SCREEN_CLOSED = "closed";

/**
 * Game presenter owns the game panel and reacts to explicit gameplay screens.
 *
 * Screens:
 * - `hidden`
 *   initial idle state before a round starts.
 *
 * - `start`
 *   entered from `state-machine-transitioned(step-1-start-round)`.
 *   clears chat and appends exactly one intro message.
 *
 * - `routing`
 *   entered immediately after a Yes/No click and reinforced by `state-machine-transitioned(step-2-decide-current-node-type)`.
 *   hides all answer controls before publishing or accepting another choice.
 *
 * - `choice`
 *   entered from `game-question-asked`.
 *   appends one game question and shows Yes/No actions.
 *   the first answer immediately enters routing before its UI event is published.
 *
 * - `input`
 *   entered from `state-machine-transitioned(step-7-request-user-animal)`,
 *   `game-interaction-state-changed(input)`, or legacy `game-context-changed(input)`.
 *   Step 7 appends the initial animal request once per round, then exposes a fresh input
 *   only while the state machine is waiting for `ui-animal-submit`.
 *
 * - `validating-animal`
 *   entered immediately after the first animal submit and reinforced by
 *   `state-machine-transitioned(step-8-validate-user-animal)`.
 *   hides all controls before publishing another submission; step 8 creates or updates the shared progress bubble.
 *
 * - `invalid-animal-feedback`
 *   entered from `state-machine-transitioned(step-9-report-invalid-animal)`.
 *   removes transient validation progress, appends localized feedback, and keeps all input controls hidden.
 *   The next step 7 transition exposes the fresh input after the state machine starts waiting again.
 *
 * - `generating-question`
 *   entered from `state-machine-transitioned(step-10-generate-question)`.
 *   creates or updates one shared progress bubble and hides all controls.
 *
 * - `validating-question`
 *   entered from `state-machine-transitioned(step-11-validate-generated-question)`.
 *   updates the same progress bubble; retries never append another chat message.
 *
 * - `saving-learning`
 *   entered from `state-machine-transitioned(step-12-save-learned-question)`.
 *   updates the same progress bubble and keeps all controls hidden.
 *
 * - `restart`
 *   appends a non-error round result after `game-finished` without clearing chat.
 *   shows retry/close controls.
 *   the first lifecycle action immediately hides both controls before its UI event is published.
 *
 * - `error`
 *   entered from `game-finished` with result `invalid`.
 *   removes transient progress, appends a localized error without clearing chat,
 *   and exposes retry/close controls.
 *
 * - `lifecycle-pending`
 *   entered immediately after Try Again or Close Game.
 *   keeps all result controls hidden until the next lifecycle event or round.
 *
 * - `closed`
 *   appends a static closed message after `game-closed` without clearing chat.
 *
 * Accepts:
 * - `app-static-resources-changed` updates localized button labels and game copy.
 * - `state-machine-transitioned` for `game-state-machine` drives presenter screens.
 * - `game-chat-cleared` clears the visible chat log.
 * - `game-chat-message-added` appends one new chat bubble without rerendering older items.
 * - `game-question-asked` appends one question bubble and shows Yes/No actions.
 * - `game-interaction-state-changed` keeps backward compatibility for explicit mode switches.
 * - `game-context-changed` keeps backward compatibility with the legacy full-context flow.
 * - `game-finished` appends a result or error and shows retry/close actions.
 * - `game-closed` appends the static closed state and hides all actions.
 *
 * Emits:
 * - `ui-choice-yes` when the yes button is clicked.
 * - `ui-choice-no` when the no button is clicked.
 * - `ui-animal-submit` after the first submit while the input screen is active.
 * - `ui-game-retry-requested` after the first retry action on a result screen.
 * - `ui-game-close-requested` after the first close action on a result screen.
 */
export class GamePresenter extends PresenterBase {
  constructor(config = {}) {
    super(config);
    this.gameTitleElement = this.findById("game-title");
    this.chatLogElement = this.findById("chat-log");
    this.choiceRowElement = this.findById("choice-row");
    this.yesButtonElement = this.findById("yes-button");
    this.noButtonElement = this.findById("no-button");
    this.inputRowElement = this.findById("input-row");
    this.animalInputElement = this.findById("animal-input");
    this.submitAnimalButtonElement = this.findById("submit-animal-button");
    this.restartRowElement = this.findById("restart-row");
    this.restartButtonElement = this.findById("restart-button");
    this.closeGameButtonElement = this.findById("close-game-button");
    this.resources = null;
    this.currentScreen = SCREEN_HIDDEN;
    this.hasRequestedUserAnimal = false;
    this.progressMessageElement = null;
    this.initialize();
  }

  initialize() {
    if (!this.beginInitialize()) {
      return;
    }

    this.listen(this.yesButtonElement, "click", () => {
      this.submitChoice(EventIds.uiChoiceYes);
    });

    this.listen(this.noButtonElement, "click", () => {
      this.submitChoice(EventIds.uiChoiceNo);
    });

    this.listen(this.submitAnimalButtonElement, "click", () => {
      this.submitAnimal();
    });

    this.listen(this.restartButtonElement, "click", () => {
      this.submitFinishedAction(EventIds.uiGameRetryRequested);
    });

    this.listen(this.closeGameButtonElement, "click", () => {
      this.submitFinishedAction(EventIds.uiGameCloseRequested);
    });

    this.listen(this.animalInputElement, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitAnimal();
      }
    });

    this.subscribeMany([
      {
        eventId: EventIds.appStaticResourcesChanged,
        handler: (resources) => {
          this.renderResources(resources);
        },
      },
      {
        eventId: EventIds.stateMachineTransitioned,
        handler: (message) => {
          this.handleStateMachineTransition(message);
        },
      },
      {
        eventId: EventIds.gameChatCleared,
        handler: () => {
          this.clearChat();
        },
      },
      {
        eventId: EventIds.gameChatMessageAdded,
        handler: (message) => {
          this.appendChatMessage(message);
        },
      },
      {
        eventId: EventIds.gameQuestionAsked,
        handler: (message) => {
          this.handleGameQuestionAsked(message);
        },
      },
      {
        eventId: EventIds.gameInteractionStateChanged,
        handler: (message) => {
          this.renderInteractionState(message);
        },
      },
      {
        eventId: EventIds.gameContextChanged,
        handler: (gameContext) => {
          this.renderGame(gameContext);
        },
      },
      {
        eventId: EventIds.gameFinished,
        handler: (message) => {
          this.renderGameFinished(message);
        },
      },
      {
        eventId: EventIds.gameClosed,
        handler: () => {
          this.renderGameClosed();
        },
      },
    ]);
  }

  renderResources(resources) {
    this.resources = resources;
    this.gameTitleElement.textContent = resources.ui.gameTitle;
    this.yesButtonElement.textContent = resources.ui.yesButton;
    this.noButtonElement.textContent = resources.ui.noButton;
    this.submitAnimalButtonElement.textContent = resources.ui.saveButton;
    this.restartButtonElement.textContent = resources.ui.gameTryAgainButton || resources.ui.restart;
    this.closeGameButtonElement.textContent = resources.ui.gameCloseButton;
    this.animalInputElement.placeholder = resources.ui.animalInputPlaceholder;
  }

  handleStateMachineTransition(message) {
    if (message?.machineId !== GAME_MACHINE_ID) {
      return;
    }

    const stepId = String(message?.currentNodeId || "");
    if (stepId === STEP_START_ROUND) {
      this.renderStartRoundScreen();
      return;
    }

    if (stepId === STEP_DECIDE_CURRENT_NODE_TYPE) {
      this.enterScreen(SCREEN_ROUTING);
      return;
    }

    if (stepId === STEP_VALIDATE_USER_ANIMAL) {
      this.renderValidateUserAnimalScreen();
      return;
    }

    if (stepId === STEP_REPORT_INVALID_ANIMAL) {
      this.renderInvalidAnimalInputScreen();
      return;
    }

    if (stepId === STEP_GENERATE_QUESTION) {
      this.renderGenerateQuestionScreen();
      return;
    }

    if (stepId === STEP_VALIDATE_GENERATED_QUESTION) {
      this.renderValidateGeneratedQuestionScreen();
      return;
    }

    if (stepId === STEP_SAVE_LEARNED_QUESTION) {
      this.renderSaveLearnedQuestionScreen();
      return;
    }

    if (stepId === STEP_REQUEST_USER_ANIMAL) {
      this.renderRequestUserAnimalScreen();
    }
  }

  submitChoice(eventId) {
    if (this.currentScreen !== SCREEN_CHOICE) {
      return;
    }

    this.enterScreen(SCREEN_ROUTING);
    this.publish(eventId, null);
  }

  submitAnimal() {
    if (this.currentScreen !== SCREEN_INPUT) {
      return;
    }

    const animalInput = this.animalInputElement.value;
    this.enterScreen(SCREEN_VALIDATING_ANIMAL);
    this.publish(EventIds.uiAnimalSubmit, animalInput);
  }

  submitFinishedAction(eventId) {
    if (this.currentScreen !== SCREEN_RESTART && this.currentScreen !== SCREEN_ERROR) {
      return;
    }

    this.enterScreen(SCREEN_LIFECYCLE_PENDING);
    this.publish(eventId, null);
  }

  handleGameQuestionAsked(message) {
    this.appendChatMessage({
      role: String(message?.role || "game"),
      message: String(message?.text || ""),
    });
    this.enterScreen(SCREEN_CHOICE);
  }

  renderInteractionState(message) {
    const nextMode = String(message?.mode || SCREEN_HIDDEN);
    this.enterScreen(nextMode);
  }

  enterScreen(screen) {
    this.currentScreen = screen;
    const isVisible = screen !== SCREEN_HIDDEN;

    this.rootElement.classList.toggle("hidden", !isVisible);
    const showsLifecycleActions = screen === SCREEN_RESTART || screen === SCREEN_ERROR;
    this.choiceRowElement.classList.toggle("hidden", screen !== SCREEN_CHOICE);
    this.inputRowElement.classList.toggle("hidden", screen !== SCREEN_INPUT);
    this.restartRowElement.classList.toggle("hidden", !showsLifecycleActions);

    if (screen === SCREEN_INPUT) {
      this.animalInputElement.value = "";
      this.animalInputElement.focus();
    }
  }

  clearChat() {
    this.chatLogElement.textContent = "";
    this.progressMessageElement = null;
  }

  appendChatMessage(item) {
    const role = String(item?.role || "game");
    const message = String(item?.message || "");
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = message;
    this.chatLogElement.appendChild(bubble);
    this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
    return bubble;
  }

  setProgressMessage(message) {
    if (!this.progressMessageElement?.isConnected) {
      this.progressMessageElement = this.appendChatMessage({
        role: "game",
        message,
      });
      this.progressMessageElement.classList.add("progress");
      return;
    }

    this.progressMessageElement.textContent = String(message || "");
    this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
  }

  clearProgressMessage() {
    if (this.progressMessageElement?.isConnected) {
      this.progressMessageElement.remove();
    }
    this.progressMessageElement = null;
  }

  renderStartRoundScreen() {
    this.hasRequestedUserAnimal = false;
    this.enterScreen(SCREEN_START);
    this.clearChat();
    this.appendChatMessage({
      role: "game",
      message: this.startRoundMessage(),
    });
  }

  renderRequestUserAnimalScreen() {
    if (!this.hasRequestedUserAnimal) {
      this.appendChatMessage({
        role: "game",
        message: this.requestAnimalMessage(),
      });
      this.hasRequestedUserAnimal = true;
    }

    this.enterScreen(SCREEN_INPUT);
  }

  renderValidateUserAnimalScreen() {
    this.setProgressMessage(this.validatingAnimalInputMessage());
    this.enterScreen(SCREEN_VALIDATING_ANIMAL);
  }

  renderInvalidAnimalInputScreen() {
    this.clearProgressMessage();
    this.appendChatMessage({
      role: "game",
      message: this.invalidAnimalInputMessage(),
    });
    this.enterScreen(SCREEN_INVALID_ANIMAL_FEEDBACK);
  }

  renderGenerateQuestionScreen() {
    this.setProgressMessage(this.generatingQuestionMessage());
    this.enterScreen(SCREEN_GENERATING_QUESTION);
  }

  renderValidateGeneratedQuestionScreen() {
    this.setProgressMessage(this.validatingQuestionMessage());
    this.enterScreen(SCREEN_VALIDATING_QUESTION);
  }

  renderSaveLearnedQuestionScreen() {
    this.setProgressMessage(this.savingLearningMessage());
    this.enterScreen(SCREEN_SAVING_LEARNING);
  }

  renderGame(gameContext) {
    const safeContext = gameContext || { visible: false, mode: SCREEN_HIDDEN, chat: [] };
    this.clearChat();
    for (const item of safeContext.chat || []) {
      this.appendChatMessage(item);
    }

    if (!safeContext.visible) {
      this.enterScreen(SCREEN_HIDDEN);
      return;
    }

    this.enterScreen(String(safeContext.mode || SCREEN_CHOICE));
  }

  renderGameFinished(message) {
    const result = String(message?.result || "invalid");
    this.clearProgressMessage();

    if (result === "invalid") {
      this.renderGameError();
      return;
    }

    this.enterScreen(SCREEN_RESTART);
    this.appendChatMessage({
      role: "game",
      message: this.finishedMessage(result),
    });
  }

  renderGameError() {
    this.enterScreen(SCREEN_ERROR);
    const errorBubble = this.appendChatMessage({
      role: "game",
      message: this.finishedMessage("invalid"),
    });
    errorBubble.classList.add("error");
  }

  renderGameClosed() {
    this.clearProgressMessage();
    this.enterScreen(SCREEN_CLOSED);
    this.appendChatMessage({
      role: "game",
      message: this.closedMessage(),
    });
  }

  startRoundMessage() {
    return this.resources?.game?.messages?.roundStarted || "Let us play. Think of an animal and I will try to guess it.";
  }

  requestAnimalMessage() {
    return this.resources?.game?.messages?.lostAskAnimal || "I could not guess your animal. Which animal were you thinking of?";
  }

  validatingAnimalInputMessage() {
    return this.resources?.game?.messages?.validatingAnimalInput
      || "Let me check that...";
  }

  invalidAnimalInputMessage() {
    return this.resources?.game?.messages?.invalidAnimalInput
      || "Very funny. Give me one clear, common animal name in English, and make sure it is different from the animal I just guessed.";
  }

  generatingQuestionMessage() {
    return this.resources?.game?.messages?.generatingQuestion
      || "Let me think about that...";
  }

  validatingQuestionMessage() {
    return this.resources?.game?.messages?.validatingQuestion
      || "One moment, I am checking something...";
  }

  savingLearningMessage() {
    return this.resources?.game?.messages?.savingLearning
      || "Almost done...";
  }

  finishedMessage(result) {
    const key = String(result || "invalid");
    return this.resources?.game?.finished?.[key]
      || this.resources?.game?.finished?.invalid
      || `Game finished: ${key}`;
  }

  closedMessage() {
    return this.resources?.game?.finished?.closed || "The game session is closed. Press F5 to start again.";
  }
}
