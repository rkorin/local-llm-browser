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
    messages: {
      roundStarted: "Let us play. Think of an animal and I will try to guess it.",
      lostAskAnimal: "I could not guess your animal. Which animal were you thinking of?",
      validatingAnimalInput: "Let me check that...",
      invalidAnimalInput: "Very funny. Give me one clear, common animal name in English, and make sure it is different from the animal I just guessed.",
      generatingQuestion: "Let me think about that...",
      validatingQuestion: "One moment, I am checking something...",
      savingLearning: "Almost done...",
    },
    finished: {
      won: "I guessed it!",
      lost: "I did not guess your animal this time.",
      invalid: "Something went wrong, so I had to stop this round. You can try again.",
      closed: "The game session is closed. Press F5 to start again.",
    },
  },
};

export function runGamePresenterTests() {
  return [
    runTest("presenter-game-001 resource event updates game labels", async () => {
      const fixture = createGamePresenterFixture();

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

    runTest("presenter-game-002 game state machine start step clears chat and appends exactly one intro message", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.gameChatMessageAdded, { role: "user", message: "stale" });

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: null,
        currentNodeId: "step-1-start-round",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should show the game root on the start-round step");
      assertEqual(fixture.root.querySelector("#chat-log").children.length, 1, "GamePresenter should clear the chat before appending the single intro message");
      assertEqual(fixture.root.querySelector("#chat-log").children[0].textContent, "Let us play. Think of an animal and I will try to guess it.", "GamePresenter should append the localized intro message on the start-round step");
      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should keep yes/no actions hidden on the intro screen");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should keep input hidden on the intro screen");

      fixture.cleanup();
    }),

    runTest("presenter-game-003 one question event appends one bubble and shows yes/no controls", async () => {
      const fixture = createGamePresenterFixture();

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: null,
        currentNodeId: "step-1-start-round",
      });
      const firstBubble = fixture.root.querySelector("#chat-log").children[0];

      fixture.eventBus.publish(EventIds.gameQuestionAsked, {
        kind: "yes-no-question",
        role: "game",
        text: "Is it cat?",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should keep the game root visible after a question event");
      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should append one new chat bubble for the question event");
      assertEqual(fixture.root.querySelector("#chat-log").children[0], firstBubble, "GamePresenter should keep the existing intro bubble when appending the question bubble");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "Is it cat?", "GamePresenter should append the question text from the domain event");
      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), false, "GamePresenter should show yes/no controls for a question event");

      fixture.cleanup();
    }),

    runTest("presenter-game-004 first choice click hides controls and blocks duplicate answers", async () => {
      const fixture = createGamePresenterFixture();
      const choices = [];
      fixture.eventBus.subscribe(EventIds.uiChoiceYes, "test:game-panel:choice-lock:yes", (event) => {
        choices.push(event);
      });
      fixture.eventBus.subscribe(EventIds.uiChoiceNo, "test:game-panel:choice-lock:no", (event) => {
        choices.push(event);
      });

      fixture.eventBus.publish(EventIds.gameQuestionAsked, {
        kind: "yes-no-question",
        role: "game",
        text: "Is it cat?",
      });

      fixture.root.querySelector("#yes-button").click();
      fixture.root.querySelector("#no-button").click();
      fixture.root.querySelector("#yes-button").click();

      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should hide choice controls immediately after the first answer");
      assertEqual(choices.length, 1, "GamePresenter should publish only one answer while leaving the choice screen");
      assertEqual(choices[0].id, EventIds.uiChoiceYes, "GamePresenter should preserve the first selected answer");

      fixture.cleanup();
    }),
    runTest("presenter-game-005 first animal submit hides input and blocks duplicate submissions", async () => {
      const fixture = createGamePresenterFixture();
      const submissions = [];
      fixture.eventBus.subscribe(EventIds.uiAnimalSubmit, "test:game-panel:animal-lock", (event) => {
        submissions.push(event);
      });
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });
      fixture.root.querySelector("#animal-input").value = "whale";

      fixture.root.querySelector("#submit-animal-button").click();
      fixture.root.querySelector("#submit-animal-button").click();
      fixture.root.querySelector("#animal-input").dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));

      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should hide animal input immediately after the first submission");
      assertEqual(submissions.length, 1, "GamePresenter should publish only one animal submission while leaving the input screen");
      assertEqual(submissions[0].message, "whale", "GamePresenter should preserve the first submitted animal value");

      fixture.cleanup();
    }),

    runTest("presenter-game-006 step 7 asks for the missed animal once and shows input", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: null,
        currentNodeId: "step-1-start-round",
      });
      fixture.eventBus.publish(EventIds.gameQuestionAsked, {
        kind: "yes-no-question",
        role: "game",
        text: "Is it cat?",
      });

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 3, "GamePresenter should append one animal request when step 7 starts");
      assertEqual(fixture.root.querySelector("#chat-log").children[2].textContent, "I could not guess your animal. Which animal were you thinking of?", "GamePresenter should ask the user for the animal name at step 7");
      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should hide yes/no controls at step 7");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), false, "GamePresenter should show the input row at step 7");

      fixture.cleanup();
    }),

    runTest("presenter-game-007 steps 8 and 9 hide input until step 7 accepts a retry", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });
      fixture.root.querySelector("#animal-input").value = "dragon";

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-7-request-user-animal",
        currentNodeId: "step-8-validate-user-animal",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should append validation progress at step 8");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "Let me check that...", "GamePresenter should append the localized validation-progress message at step 8");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should hide animal input while step 8 validates it");
      assertEqual(fixture.root.querySelector("#animal-input").value, "dragon", "GamePresenter should preserve the hidden submitted value until validation finishes");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-8-validate-user-animal",
        currentNodeId: "step-9-report-invalid-animal",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should replace validation progress with exactly one feedback message at step 9");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "Very funny. Give me one clear, common animal name in English, and make sure it is different from the animal I just guessed.", "GamePresenter should replace validation progress with the localized invalid-animal message at step 9");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should keep animal input hidden while step 9 delays the retry");
      assertEqual(fixture.root.querySelector("#animal-input").value, "dragon", "GamePresenter should not expose or clear input before the state machine waits for another submission");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-9-report-invalid-animal",
        currentNodeId: "step-7-request-user-animal",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should not repeat the animal prompt after step 9 returns to step 7");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), false, "GamePresenter should expose a fresh input only after step 7 starts waiting again");
      assertEqual(fixture.root.querySelector("#animal-input").value, "", "GamePresenter should clear the rejected value when step 7 exposes the fresh input");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-16-restart-or-close",
        currentNodeId: "step-1-start-round",
      });
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should ask for the missed animal again in a new round");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "I could not guess your animal. Which animal were you thinking of?", "GamePresenter should reset its per-round animal-request flag at step 1");

      fixture.cleanup();
    }),

    runTest("presenter-game-008 steps 10 through 12 update one progress bubble without chat spam", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });
      fixture.root.querySelector("#animal-input").value = "whale";
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-7-request-user-animal",
        currentNodeId: "step-8-validate-user-animal",
      });

      const progressBubble = fixture.root.querySelector("#chat-log").children[1];

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-8-validate-user-animal",
        currentNodeId: "step-10-generate-question",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should reuse the animal-validation progress bubble at step 10");
      assertEqual(fixture.root.querySelector("#chat-log").children[1], progressBubble, "GamePresenter should preserve progress bubble identity at step 10");
      assertEqual(progressBubble.textContent, "Let me think about that...", "GamePresenter should show question-generation progress at step 10");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-10-generate-question",
        currentNodeId: "step-11-validate-generated-question",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should not append another bubble at step 11");
      assertEqual(fixture.root.querySelector("#chat-log").children[1], progressBubble, "GamePresenter should preserve progress bubble identity at step 11");
      assertEqual(progressBubble.textContent, "One moment, I am checking something...", "GamePresenter should show question-validation progress at step 11");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-11-validate-generated-question",
        currentNodeId: "step-10-generate-question",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should update rather than append when step 11 retries step 10");
      assertEqual(fixture.root.querySelector("#chat-log").children[1], progressBubble, "GamePresenter should keep the same progress bubble across retries");
      assertEqual(progressBubble.textContent, "Let me think about that...", "GamePresenter should restore generation progress on retry");

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-10-generate-question",
        currentNodeId: "step-11-validate-generated-question",
      });
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-11-validate-generated-question",
        currentNodeId: "step-12-save-learned-question",
      });

      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should not append another bubble at step 12");
      assertEqual(fixture.root.querySelector("#chat-log").children[1], progressBubble, "GamePresenter should preserve progress bubble identity while saving");
      assertEqual(progressBubble.textContent, "Almost done...", "GamePresenter should show saving progress at step 12");
      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should hide choice controls during learning");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), true, "GamePresenter should hide input controls during learning");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide lifecycle controls during learning");

      fixture.cleanup();
    }),

    runTest("presenter-game-009 interaction-state event switches to input mode and clears input field", async () => {
      const fixture = createGamePresenterFixture();
      fixture.root.querySelector("#animal-input").value = "old value";

      fixture.eventBus.publish(EventIds.gameInteractionStateChanged, { mode: "input" });

      assertEqual(fixture.root.querySelector("#choice-row").classList.contains("hidden"), true, "GamePresenter should hide choice row in input mode");
      assertEqual(fixture.root.querySelector("#input-row").classList.contains("hidden"), false, "GamePresenter should show input row in input mode");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide restart row in input mode");
      assertEqual(fixture.root.querySelector("#animal-input").value, "", "GamePresenter should clear the animal input when entering input mode");

      fixture.cleanup();
    }),

    runTest("presenter-game-010 game-finished shows result screen with retry and close actions", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.gameChatMessageAdded, {
        role: "game",
        message: "Previous round message",
      });
      const previousBubble = fixture.root.querySelector("#chat-log").children[0];

      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "won",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should show the game panel for the result screen");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), false, "GamePresenter should show retry/close actions after game-finished");
      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should append the final result without clearing round history");
      assertEqual(fixture.root.querySelector("#chat-log").children[0], previousBubble, "GamePresenter should preserve existing round messages at game-finished");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "I guessed it!", "GamePresenter should append the localized final result message from the game perspective");

      fixture.cleanup();
    }),

    runTest("presenter-game-011 invalid result replaces progress with an incremental retryable error", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);
      fixture.eventBus.publish(EventIds.gameChatMessageAdded, {
        role: "game",
        message: "Previous round message",
      });
      const previousBubble = fixture.root.querySelector("#chat-log").children[0];
      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-7-request-user-animal",
        currentNodeId: "step-8-validate-user-animal",
      });

      let retryEvent = null;
      fixture.eventBus.subscribe(EventIds.uiGameRetryRequested, "test:game-panel:error-retry", (event) => {
        retryEvent = event;
      });
      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "invalid",
      });

      const chat = fixture.root.querySelector("#chat-log");
      assertEqual(chat.children.length, 2, "GamePresenter should remove transient progress and append one error without clearing history");
      assertEqual(chat.children[0], previousBubble, "GamePresenter should preserve existing round messages on invalid result");
      assertEqual(chat.children[1].textContent, "Something went wrong, so I had to stop this round. You can try again.", "GamePresenter should append the localized user-facing error");
      assertEqual(chat.children[1].classList.contains("error"), true, "GamePresenter should visually mark the invalid result as an error");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), false, "GamePresenter should allow retry or close from the error screen");

      fixture.root.querySelector("#restart-button").click();

      assertEqual(retryEvent?.id, EventIds.uiGameRetryRequested, "GamePresenter should publish retry from the error screen");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should lock error actions immediately after retry");

      fixture.cleanup();
    }),
    runTest("presenter-game-012 first result action hides controls and blocks competing lifecycle actions", async () => {
      const fixture = createGamePresenterFixture();
      const lifecycleActions = [];
      fixture.eventBus.subscribe(EventIds.uiGameRetryRequested, "test:game-panel:lifecycle-lock:retry", (event) => {
        lifecycleActions.push(event);
      });
      fixture.eventBus.subscribe(EventIds.uiGameCloseRequested, "test:game-panel:lifecycle-lock:close", (event) => {
        lifecycleActions.push(event);
      });
      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "won",
      });

      fixture.root.querySelector("#restart-button").click();
      fixture.root.querySelector("#close-game-button").click();
      fixture.root.querySelector("#restart-button").click();

      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide result actions immediately after retry");
      assertEqual(lifecycleActions.length, 1, "GamePresenter should publish only the first lifecycle action from one result screen");
      assertEqual(lifecycleActions[0].id, EventIds.uiGameRetryRequested, "GamePresenter should preserve the first retry action");

      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "lost",
      });
      fixture.root.querySelector("#close-game-button").click();
      fixture.root.querySelector("#restart-button").click();

      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide result actions immediately after close");
      assertEqual(lifecycleActions.length, 2, "GamePresenter should accept one new lifecycle action after a new result screen");
      assertEqual(lifecycleActions[1].id, EventIds.uiGameCloseRequested, "GamePresenter should preserve the first close action");

      fixture.cleanup();
    }),

    runTest("presenter-game-013 game-closed shows static closed message and hides actions", async () => {
      const fixture = createGamePresenterFixture();
      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      fixture.eventBus.publish(EventIds.gameChatMessageAdded, {
        role: "game",
        message: "Existing result",
      });
      const existingBubble = fixture.root.querySelector("#chat-log").children[0];

      fixture.eventBus.publish(EventIds.gameClosed, {
        result: "won",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "GamePresenter should keep the panel visible in the closed static state");
      assertEqual(fixture.root.querySelector("#restart-row").classList.contains("hidden"), true, "GamePresenter should hide retry/close actions after the session is closed");
      assertEqual(fixture.root.querySelector("#chat-log").children.length, 2, "GamePresenter should append the closed message without clearing history");
      assertEqual(fixture.root.querySelector("#chat-log").children[0], existingBubble, "GamePresenter should preserve the existing result when the session closes");
      assertEqual(fixture.root.querySelector("#chat-log").children[1].textContent, "The game session is closed. Press F5 to start again.", "GamePresenter should append the static closed message");

      fixture.cleanup();
    }),

    runTest("presenter-game-014 clicks publish game UI events through the event bus", async () => {
      const fixture = createGamePresenterFixture();
      const published = [];
      fixture.eventBus.subscribe("all", "test:game-panel:published", (event) => {
        published.push(event);
      });

      fixture.eventBus.publish(EventIds.gameQuestionAsked, {
        kind: "yes-no-question",
        role: "game",
        text: "First question?",
      });
      fixture.root.querySelector("#yes-button").click();

      fixture.eventBus.publish(EventIds.gameQuestionAsked, {
        kind: "yes-no-question",
        role: "game",
        text: "Second question?",
      });
      fixture.root.querySelector("#no-button").click();

      fixture.eventBus.publish(EventIds.stateMachineTransitioned, {
        machineId: "game-state-machine",
        previousNodeId: "step-5-remember-failed-animal-node",
        currentNodeId: "step-7-request-user-animal",
      });
      fixture.root.querySelector("#animal-input").value = "whale";
      fixture.root.querySelector("#submit-animal-button").click();

      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "won",
      });
      fixture.root.querySelector("#restart-button").click();

      fixture.eventBus.publish(EventIds.gameFinished, {
        result: "lost",
      });
      fixture.root.querySelector("#close-game-button").click();

      const uiEvents = published.filter((event) => [
        EventIds.uiChoiceYes,
        EventIds.uiChoiceNo,
        EventIds.uiAnimalSubmit,
        EventIds.uiGameRetryRequested,
        EventIds.uiGameCloseRequested,
      ].includes(event.id));

      assertEqual(uiEvents[0].id, EventIds.uiChoiceYes, "GamePresenter should publish uiChoiceYes on yes click");
      assertEqual(uiEvents[1].id, EventIds.uiChoiceNo, "GamePresenter should publish uiChoiceNo on no click");
      assertEqual(uiEvents[2].id, EventIds.uiAnimalSubmit, "GamePresenter should publish uiAnimalSubmit on submit click");
      assertEqual(uiEvents[2].message, "whale", "GamePresenter should publish the current animal input value");
      assertEqual(uiEvents[3].id, EventIds.uiGameRetryRequested, "GamePresenter should publish uiGameRetryRequested on retry click");
      assertEqual(uiEvents[4].id, EventIds.uiGameCloseRequested, "GamePresenter should publish uiGameCloseRequested on close click");

      fixture.cleanup();
    }),
  ];
}
