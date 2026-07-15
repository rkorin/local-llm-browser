import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { GamePresenter } from "./presenter-game.js";
import {
  assertEqual,
  runTest,
} from "./tests.js";

function createGamePresenterFixture() {
  const root = document.createElement("section");
  root.id = "game-panel-test";
  root.className = "hidden";
  root.innerHTML = `
    <h2 id="game-title"></h2>
    <div id="chat-log"></div>
    <div id="choice-row" class="hidden">
      <button id="yes-button" type="button"></button>
      <button id="no-button" type="button"></button>
    </div>
    <div id="input-row" class="hidden">
      <input id="animal-input" />
      <button id="submit-animal-button" type="button"></button>
    </div>
    <div id="restart-row" class="hidden">
      <button id="restart-button" type="button"></button>
      <button id="close-game-button" type="button"></button>
    </div>
  `;
  document.body.appendChild(root);

  const eventBus = new EventMessageBus();
  const presenter = new GamePresenter({ rootId: root.id, eventBus });

  return {
    root,
    eventBus,
    presenter,
    cleanup() {
      presenter.dispose();
      root.remove();
    },
  };
}

const ENGLISH_RESOURCES = {
  ui: {
    gameTitle: "Game",
    yesButton: "Yes",
    noButton: "No",
    saveButton: "Save",
    restart: "Let's play again",
    gameTryAgainButton: "Try Again",
    gameCloseButton: "Close Game",
    animalInputPlaceholder: "Type the animal name in English",
  },
  game: {
    finished: {
      won: "You won.",
      lost: "You lost.",
      cancelled: "Game cancelled.",
      invalid: "Game finished with an invalid state.",
      closed: "The game session is closed. Press F5 to start again.",
    },
  },
};

export function runGamePresenterTests() {
  return [
    runTest("presenter-game-001 resource event updates game labels", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();

      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      assertEqual(fixture.root.querySelector("#game-title").textContent, "Game", "GamePresenter should render the game title from resources");
      assertEqual(fixture.root.querySelector("#yes-button").textContent, "Yes", "GamePresenter should render the yes button label");
      assertEqual(fixture.root.querySelector("#no-button").textContent, "No", "GamePresenter should render the no button label");
      assertEqual(fixture.root.querySelector("#submit-animal-button").textContent, "Save", "GamePresenter should render the submit button label");
      assertEqual(fixture.root.querySelector("#restart-button").textContent, "Try Again", "GamePresenter should render the retry button label");
      assertEqual(fixture.root.querySelector("#close-game-button").textContent, "Close Game", "GamePresenter should render the close game button label");
      assertEqual(fixture.root.querySelector("#animal-input").placeholder, "Type the animal name in English", "GamePresenter should render the animal input placeholder");

      fixture.cleanup();
    }),

    runTest("presenter-game-002 game context renders choice mode and chat log", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();

      fixture.eventBus.publish(EventIds.gameContextChanged, {
        visible: true,
        mode: "choice",
        chat: [
          { role: "game", message: "Is it a cat?" },
          { role: "user", message: "Yes" },
        ],
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should show the game root when game context is visible");
      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), false, "GamePresenter should show choice row in choice mode");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should hide input row in choice mode");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide restart row during active gameplay");
      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should render every chat item as a bubble");
      assertEqual(fixture.root.querySelector("#chat-log").children[0].textContent, "Is it a cat?", "GamePresenter should render the first chat bubble text");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "Yes", "GamePresenter should render the second chat bubble text");

      fixture.cleanup();
    }),

    runTest("presenter-game-003 game context renders input mode and clears input field", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();
      fixture.root.querySelector("#animal-input").value = "old value";

      fixture.eventBus.publish(EventIds.gameContextChanged, {
        visible: true,
        mode: "input",
        chat: [],
      });

      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should hide choice row in input mode");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), false, "GamePresenter should show input row in input mode");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide restart row in input mode");
      assertEqual(fixture.root.querySelector("#animal-input").value, "", "GamePresenter should clear the animal input when entering input mode");

      fixture.cleanup();
    }),

    runTest("presenter-game-004 game-finished shows result screen with retry and close actions", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "won",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should show the game panel for the result screen");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), false, "GamePresenter should show retry/close actions after game-finished");
      assertEqual(fixture.root.querySelector("#chat-log").children[0].textContent, "You won.", "GamePresenter should render the localized final result message");

      fixture.cleanup();
    }),

    runTest("presenter-game-005 game-closed shows static closed message and hides actions", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.gameClosed, {
        result: "won",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should keep the panel visible in the closed static state");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide retry/close actions after the session is closed");
      assertEqual(fixture.root.querySelector("#chat-log").children[0].textContent, "The game session is closed. Press F5 to start again.", "GamePresenter should render the static closed message");

      fixture.cleanup();
    }),

    runTest("presenter-game-006 clicks publish game UI events through the event bus", async () => {
      const fixture = createGamePresenterFixture();
      fixture.presenter.initialize();
      const published = [];
      fixture.eventBus.subscribe("all", "test:game-panel:published", (event) => {
        published.push(event);
      });
      fixture.root.querySelector("#animal-input").value = "whale";

      fixture.root.querySelector("#yes-button").click();
      fixture.root.querySelector("#no-button").click();
      fixture.root.querySelector("#submit-animal-button").click();
      fixture.root.querySelector("#restart-button").click();
      fixture.root.querySelector("#close-game-button").click();

      assertEqual(published[0].id, EventIds.uiChoiceYes, "GamePresenter should publish uiChoiceYes on yes click");
      assertEqual(published[1].id, EventIds.uiChoiceNo, "GamePresenter should publish uiChoiceNo on no click");
      assertEqual(published[2].id, EventIds.uiAnimalSubmit, "GamePresenter should publish uiAnimalSubmit on submit click");
      assertEqual(published[2].message, "whale", "GamePresenter should publish the current animal input value");
      assertEqual(published[3].id, EventIds.uiGameRetryRequested, "GamePresenter should publish uiGameRetryRequested on retry click");
      assertEqual(published[4].id, EventIds.uiGameCloseRequested, "GamePresenter should publish uiGameCloseRequested on close click");

      fixture.cleanup();
    }),
  ];
}
