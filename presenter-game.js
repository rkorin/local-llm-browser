import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

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
  }

  initialize() {
    this.yesButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiChoiceYes, null);
    });

    this.noButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiChoiceNo, null);
    });

    this.submitAnimalButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiAnimalSubmit, this.animalInputElement.value);
    });

    this.restartButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiRestartRequested, null);
    });

    this.animalInputElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.publish(EventIds.uiAnimalSubmit, this.animalInputElement.value);
      }
    });

    this.subscribe(EventIds.appStaticResourcesChanged, (resources) => {
      this.renderResources(resources);
    });

    this.subscribe(EventIds.gameContextChanged, (gameContext) => {
      this.renderGame(gameContext);
    });
  }

  renderResources(resources) {
    this.gameTitleElement.textContent = resources.ui.gameTitle;
    this.yesButtonElement.textContent = resources.ui.yesButton;
    this.noButtonElement.textContent = resources.ui.noButton;
    this.submitAnimalButtonElement.textContent = resources.ui.saveButton;
    this.restartButtonElement.textContent = resources.ui.restart;
    this.animalInputElement.placeholder = resources.ui.animalInputPlaceholder;
  }

  renderGame(gameContext) {
    this.rootElement.classList.toggle("hidden", !gameContext.visible);
    this.renderChat(gameContext.chat || []);

    this.choiceRowElement.classList.toggle("hidden", gameContext.mode !== "choice");
    this.inputRowElement.classList.toggle("hidden", gameContext.mode !== "input");
    this.restartRowElement.classList.toggle("hidden", gameContext.mode !== "restart");

    if (gameContext.mode === "input") {
      this.animalInputElement.value = "";
      this.animalInputElement.focus();
    }
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
