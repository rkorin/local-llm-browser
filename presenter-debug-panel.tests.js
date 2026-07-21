import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { DebugPanelPresenter } from "./presenter-debug-panel.js";
import {
  assertEqual,
  runTest,
} from "./tests.js";

function createDebugPresenterFixture() {
  const root = document.createElement("section");
  root.id = "debug-panel-test";
  root.className = "hidden";
  root.innerHTML = `
    <h3 id="debug-title"></h3>
    <div id="debug-stage-label"></div>
    <div id="debug-prompt-label"></div>
    <div id="debug-response-label"></div>
    <pre id="debug-stage"></pre>
    <textarea id="debug-prompt-input"></textarea>
    <pre id="debug-response"></pre>
    <button id="rerun-prompt-button" type="button"></button>
  `;
  document.body.appendChild(root);

  const eventBus = new EventMessageBus();
  const presenter = new DebugPanelPresenter({ rootId: root.id, eventBus });

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
    lastModelCallTitle: "Last Model Call",
    debugStageLabel: "Stage",
    debugPromptLabel: "Prompt",
    debugResponseLabel: "Raw Response",
    debugSendAgain: "Send Again",
  },
};

export function runDebugPanelPresenterTests() {
  return [
    runTest("presenter-debug-001 resource event updates debug labels", async () => {
      const fixture = createDebugPresenterFixture();

      fixture.eventBus.publish(EventIds.appStaticResourcesChanged, ENGLISH_RESOURCES);

      assertEqual(fixture.root.querySelector("#debug-title").textContent, "Last Model Call", "DebugPanelPresenter should render debug title from resources");
      assertEqual(fixture.root.querySelector("#debug-stage-label").textContent, "Stage", "DebugPanelPresenter should render stage label");
      assertEqual(fixture.root.querySelector("#debug-prompt-label").textContent, "Prompt", "DebugPanelPresenter should render prompt label");
      assertEqual(fixture.root.querySelector("#debug-response-label").textContent, "Raw Response", "DebugPanelPresenter should render response label");
      assertEqual(fixture.root.querySelector("#rerun-prompt-button").textContent, "Send Again", "DebugPanelPresenter should render rerun button label");

      fixture.cleanup();
    }),

    runTest("presenter-debug-002 debug context renders panel visibility and content", async () => {
      const fixture = createDebugPresenterFixture();

      fixture.eventBus.publish(EventIds.debugContextChanged, {
        visible: true,
        stage: "Prompt 1",
        prompt: "Tell me about whales.",
        response: "Whales are mammals.",
      });

      assertEqual(fixture.root.classList.contains("hidden"), false, "DebugPanelPresenter should show the debug panel when visible is true");
      assertEqual(fixture.root.querySelector("#debug-stage").textContent, "Prompt 1", "DebugPanelPresenter should render debug stage text");
      assertEqual(fixture.root.querySelector("#debug-prompt-input").value, "Tell me about whales.", "DebugPanelPresenter should render debug prompt text");
      assertEqual(fixture.root.querySelector("#debug-response").textContent, "Whales are mammals.", "DebugPanelPresenter should render debug response text");

      fixture.cleanup();
    }),

    runTest("presenter-debug-003 debug rerun interactions publish bus events", async () => {
      const fixture = createDebugPresenterFixture();
      const published = [];
      fixture.eventBus.subscribe("all", "test:debug-panel:published", (event) => {
        published.push(event);
      });
      fixture.root.querySelector("#debug-prompt-input").value = "Retry this prompt.";

      fixture.root.querySelector("#rerun-prompt-button").click();

      const keyboardEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      });
      fixture.root.querySelector("#debug-prompt-input").dispatchEvent(keyboardEvent);

      assertEqual(published[0].id, EventIds.uiDebugRerunRequested, "DebugPanelPresenter should publish uiDebugRerunRequested on rerun click");
      assertEqual(published[0].message, "Retry this prompt.", "DebugPanelPresenter should publish the current debug prompt on rerun click");
      assertEqual(published[1].id, EventIds.uiDebugRerunRequested, "DebugPanelPresenter should publish uiDebugRerunRequested on Ctrl+Enter");
      assertEqual(published[1].message, "Retry this prompt.", "DebugPanelPresenter should publish the current debug prompt on Ctrl+Enter");

      fixture.cleanup();
    }),
  ];
}
