import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

/**
 * Game presenter owns the game panel and renders gameplay plus post-game result screens.
 *
 * Accepts:
 * - `app-static-resources-changed` updates localized button labels and result texts.
 * - `game-context-changed` renders the active gameplay screen (`choice`, `input`, or `restart`).
 * - `game-finished` shows the game result screen with retry/close actions.
 * - `game-closed` clears the game panel into a static closed state that tells the user to press F5.
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
  }

  initialize() {
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
        handler: (message) => {
          this.renderGameClosed(message);
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

  renderGame(gameContext) {
    const safeContext = gameContext || { visible: false, mode: "hidden", chat: [] };

    this.rootElement.classList.toggle("hidden", !safeContext.visible);
    this.renderChat(safeContext.chat || []);

    this.choiceRowElement.classList.toggle("hidden", safeContext.mode !== "choice");
    this.inputRowElement.classList.toggle("hidden", safeContext.mode !== "input");
    this.restartRowElement.classList.toggle("hidden", true);

    if (safeContext.mode === "input") {
      this.animalInputElement.value = "";
      this.animalInputElement.focus();
    }
  }

  renderGameFinished(message) {
    this.rootElement.classList.remove("hidden");
    this.choiceRowElement.classList.add("hidden");
    this.inputRowElement.classList.add("hidden");
    this.restartRowElement.classList.remove("hidden");
    this.renderChat([
      {
        role: "game",
        message: this.finishedMessage(message?.result),
      },
    ]);
  }

  renderGameClosed(_message) {
    this.rootElement.classList.remove("hidden");
    this.choiceRowElement.classList.add("hidden");
    this.inputRowElement.classList.add("hidden");
    this.restartRowElement.classList.add("hidden");
    this.renderChat([
      {
        role: "game",
        message: this.closedMessage(),
      },
    ]);
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

  renderChat(chatItems) {
    this.chatLogElement.textContent = "";

    for (const item of chatItems) {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${item.role}`;
      bubble.textContent = String(item.message);
      this.chatLogElement.appendChild(bubble);
    }

    this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
  }
}
