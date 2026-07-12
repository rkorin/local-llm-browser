import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

export class MainPresenter extends PresenterBase {
  constructor(config = {}) {
    super(config);
    this.pageTitleElement = this.findById("page-title");
    this.pageDescriptionElement = this.findById("page-description");
    this.languageLabelElement = this.findById("language-label");
    this.languageSelectElement = this.findById("language-select");
    this.statusTitleElement = this.findById("status-title");
    this.progressBarElement = this.findById("progress-bar");
    this.statusElement = this.findById("status-text");
    this.debugToggleButtonElement = this.findById("debug-toggle-button");
    this.resetTreeButtonElement = this.findById("reset-tree-button");
  }

  initialize() {
    this.languageSelectElement.addEventListener("change", () => {
      this.publish(EventIds.appResourcesReadRequested, this.languageSelectElement.value);
    });

    this.debugToggleButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiDebugToggleRequested, null);
    });

    this.resetTreeButtonElement.addEventListener("click", () => {
      this.publish(EventIds.uiResetTreeRequested, null);
    });

    this.subscribe(EventIds.appStaticResourcesChanged, (resources) => {
      this.renderResources(resources);
    });

    this.subscribe(EventIds.appStatusChanged, (statusContext) => {
      this.renderStatus(statusContext);
    });
  }

  renderResources(resources) {
    document.documentElement.lang = resources.locale;
    document.title = resources.ui.pageTitle;
    this.pageTitleElement.textContent = resources.ui.pageTitle;
    this.pageDescriptionElement.textContent = resources.ui.pageDescription;
    this.languageLabelElement.textContent = resources.ui.languageLabel;
    this.languageSelectElement.value = resources.locale;
    this.languageSelectElement.options[0].textContent = resources.ui.languages.en;
    this.languageSelectElement.options[1].textContent = resources.ui.languages.de;
    this.statusTitleElement.textContent = resources.ui.statusTitle;
    this.debugToggleButtonElement.textContent = resources.ui.debugButton;
    this.resetTreeButtonElement.textContent = resources.ui.resetBaseButton;
  }

  renderStatus(statusContext) {
    this.statusElement.textContent = String(statusContext.text || "");
    this.statusElement.classList.toggle("error", Boolean(statusContext.isError));
    this.progressBarElement.style.width = `${statusContext.progress || 0}%`;
  }
}
