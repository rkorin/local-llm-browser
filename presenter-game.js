import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

const GAME_MACHINE_ID = "game-state-machine";
const STEP_START_ROUND = "step-1-start-round";
const STEP_REQUEST_USER_ANIMAL = "step-7-request-user-animal";
const SCREEN_HIDDEN = "hidden";
const SCREEN_START = "start";
const SCREEN_CHOICE = "choice";
const SCREEN_INPUT = "input";
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
 * - `choice`
 *   entered from `game-question-asked`.
 *   appends one game question and shows Yes/No actions.
 *
 * - `input`
 *   entered from `state-machine-transitioned(step-7-request-user-animal)`, `game-interaction-state-changed(input)`, or legacy `game-context-changed(input)`.
 *   appends the loss/input prompt messages and shows the animal input form.
 *
 * - `restart`
 *   shows retry/close controls after `game-finished`.
 *
 * - `closed`
 *   shows a static closed message after `game-closed`.
 *
 * Accepts:
 * - `app-static-resources-changed` updates localized button labels and game copy.
 * - `state-machine-transitioned` for `game-state-machine` drives presenter screens.
 * - `game-chat-cleared` clears the visible chat log.
 * - `game-chat-message-added` appends one new chat bubble without rerendering older items.
 * - `game-question-asked` appends one question bubble and shows Yes/No actions.
 * - `game-interaction-state-changed` keeps backward compatibility for explicit mode switches.
 * - `game-context-changed` keeps backward compatibility with the legacy full-context flow.
 * - `game-finished` shows the post-game result screen with retry/close actions.
 * - `game-closed` clears the panel into a static closed state.
 *
 * Emits:
 * - `ui-choice-yes` when the yes button is clicked.
 * - `ui-choice-no` when the no button is clicked.
 * - `ui-animal-submit` when the animal submit button is clicked.
 * - `ui-game-retry-requested` when the user wants to start a new game round after a result.
 * - `ui-game-close-requested` when the user wants to close the finished game session.
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
    this.initialize();
  }

  initialize() {
    if (!this.beginInitialize()) {
      return;
    }

    this.listen(this.yesButtonElement, "click", () => {
      this.publish(EventIds.uiChoiceYes, null);
    });

    this.listen(this.noButtonElement, "click", () => {
      this.publish(EventIds.uiChoiceNo, null);
    });

    this.listen(this.submitAnimalButtonElement, "click", () => {
      this.publish(EventIds.uiAnimalSubmit, this.animalInputElement.value);
    });

    this.listen(this.restartButtonElement, "click", () => {
      this.publish(EventIds.uiGameRetryRequested, null);
    });

    this.listen(this.closeGameButtonElement, "click", () => {
      this.publish(EventIds.uiGameCloseRequested, null);
    });

    this.listen(this.animalInputElement, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.publish(EventIds.uiAnimalSubmit, this.animalInputElement.value);
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

    if (stepId === STEP_REQUEST_USER_ANIMAL) {
      this.renderRequestUserAnimalScreen();
    }
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
    this.choiceRowElement.classList.toggle("hidden", screen !== SCREEN_CHOICE);
    this.inputRowElement.classList.toggle("hidden", screen !== SCREEN_INPUT);
    this.restartRowElement.classList.toggle("hidden", screen !== SCREEN_RESTART);

    if (screen === SCREEN_INPUT) {
      this.animalInputElement.value = "";
      this.animalInputElement.focus();
    }
  }

  clearChat() {
    this.chatLogElement.textContent = "";
  }

  appendChatMessage(item) {
    const role = String(item?.role || "game");
    const message = String(item?.message || "");
    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = message;
    this.chatLogElement.appendChild(bubble);
    this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
  }

  renderStartRoundScreen() {
    this.enterScreen(SCREEN_START);
    this.clearChat();
    this.appendChatMessage({
      role: "game",
      message: this.startRoundMessage(),
    });
  }

  renderRequestUserAnimalScreen() {
    this.appendChatMessage({
      role: "game",
      message: this.roundLostMessage(),
    });
    this.appendChatMessage({
      role: "game",
      message: this.requestAnimalMessage(),
    });
    this.enterScreen(SCREEN_INPUT);
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
    this.enterScreen(SCREEN_RESTART);
    this.clearChat();
    this.appendChatMessage({
      role: "game",
      message: this.finishedMessage(message?.result),
    });
  }

  renderGameClosed() {
    this.currentScreen = SCREEN_CLOSED;
    this.rootElement.classList.remove("hidden");
    this.choiceRowElement.classList.add("hidden");
    this.inputRowElement.classList.add("hidden");
    this.restartRowElement.classList.add("hidden");
    this.clearChat();
    this.appendChatMessage({
      role: "game",
      message: this.closedMessage(),
    });
  }

  startRoundMessage() {
    return this.resources?.game?.messages?.roundStarted || "Let us play. Think of an animal and I will try to guess it.";
  }

  roundLostMessage() {
    return this.resources?.game?.finished?.lost || "You lost.";
  }

  requestAnimalMessage() {
    return this.resources?.game?.messages?.lostAskAnimal || "I did not guess it. Which animal did you choose?";
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
