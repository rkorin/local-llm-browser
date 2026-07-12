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
    this.rerunPromptButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiDebugRerunRequested, this.debugPromptInputElement.value);
    });

    this.debugPromptInputElement.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.publish(EventIds.uiDebugRerunRequested, this.debugPromptInputElement.value);
      }
    });

    this.subscribe(EventIds.appStaticResourcesChanged, (resources) => {
      this.renderResources(resources);
    });

    this.subscribe(EventIds.debugContextChanged, (debugContext) => {
      this.renderDebug(debugContext);
    });
  }

  renderResources(resources) {
    this.debugTitleElement.textContent = resources.ui.lastModelCallTitle;
    this.debugStageLabelElement.textContent = resources.ui.debugStageLabel;
    this.debugPromptLabelElement.textContent = resources.ui.debugPromptLabel;
    this.debugResponseLabelElement.textContent = resources.ui.debugResponseLabel;
    this.rerunPromptButtonElement.textContent = resources.ui.debugSendAgain;
  }

  renderDebug(debugContext) {
    this.rootElement.classList.toggle("hidden", !debugContext.visible);
    this.debugStageElement.textContent = debugContext.stage;
    this.debugPromptInputElement.value = debugContext.prompt;
    this.debugResponseElement.textContent = debugContext.response;
  }
}
