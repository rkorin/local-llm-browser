import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

export class DebugPanelPresenter extends PresenterBase {
  constructor(config = {}) {
    super(config);
    this.debugTitleElement = this.findById("debug-title");
    this.debugStageLabelElement = this.findById("debug-stage-label");
    this.debugPromptLabelElement = this.findById("debug-prompt-label");
    this.debugResponseLabelElement = this.findById("debug-response-label");
    this.debugStageElement = this.findById("debug-stage");
    this.debugPromptInputElement = this.findById("debug-prompt-input");
    this.debugResponseElement = this.findById("debug-response");
    this.rerunPromptButtonElement = this.findById("rerun-prompt-button");
  }

  initialize() {
    this.listen(this.rerunPromptButtonElement, "click", () => {
      this.publish(EventIds.uiDebugRerunRequested, this.debugPromptInputElement.value);
    });

    this.listen(this.debugPromptInputElement, "keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.publish(EventIds.uiDebugRerunRequested, this.debugPromptInputElement.value);
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
        eventId: EventIds.debugContextChanged,
        handler: (debugContext) => {
          this.renderDebug(debugContext);
        },
      },
    ]);
  }

  renderResources(resources) {
    this.debugTitleElement.textContent = resources.ui.lastModelCallTitle;
    this.debugStageLabelElement.textContent = resources.ui.debugStageLabel;
    this.debugPromptLabelElement.textContent = resources.ui.debugPromptLabel;
    this.debugResponseLabelElement.textContent = resources.ui.debugResponseLabel;
    this.rerunPromptButtonElement.textContent = resources.ui.debugSendAgain;
  }

  renderDebug(debugContext) {
    const safeContext = debugContext || {
      visible: false,
      stage: "",
      prompt: "",
      response: "",
    };

    this.rootElement.classList.toggle("hidden", !safeContext.visible);
    this.debugStageElement.textContent = String(safeContext.stage || "");
    this.debugPromptInputElement.value = String(safeContext.prompt || "");
    this.debugResponseElement.textContent = String(safeContext.response || "");
  }
}
