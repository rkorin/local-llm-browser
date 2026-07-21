import { EventIds } from "./event-ids.js";
import { PresenterBase } from "./presenter-base.js";

const BOOTSTRAP_MACHINE_ID = "bootstrap-state-machine";
const SCREEN_BASE = "base";
const SCREEN_APPLY_STATIC_RESOURCES = "apply-static-resources";
const SCREEN_VERIFY_PROVIDER = "verify-provider";
const SCREEN_WAIT_FOR_PROVIDER = "wait-for-provider";
const SCREEN_PROVIDER_ERROR = "provider-error";
const SCREEN_SEND_PROVIDER_HEALTHCHECK = "send-provider-healthcheck";
const SCREEN_WAIT_FOR_USER_GAME_START = "wait-for-user-game-start";
const PROVIDER_PROGRESS_SCREENS = new Set([
  SCREEN_VERIFY_PROVIDER,
]);

/**
 * Main presenter owns the main status screen and thinks in bootstrap screens/states.
 *
 * Screens:
 * - `base`
 *   the presenter draws this screen immediately on startup
 *   shows the generic bootstrap loading state before any machine transition arrives
 *   the presenter is already subscribed to all relevant events while this screen is active.
 *
 * - `apply-static-resources`
 *   entered from `state-machine-transitioned`
 *   shows that static resources are loading
 *   keeps listening to `app-static-resources-changed` and stores the latest resources locally.
 *
 * - `verify-provider`
 *   visual bootstrap provider screen
 *   both machine steps `verify-provider` and `wait-for-provider` are normalized into this one visual screen
 *   so the presenter does not flicker while the machine loops between provider status checks and waiting.
 *
 * - `provider-error`
 *   entered from `state-machine-transitioned`
 *   shows the fatal provider/bootstrap error state.
 *
 * - `send-provider-healthcheck`
 *   entered from `state-machine-transitioned`
 *   means the provider is already ready and the bootstrap flow has already sent a hello prompt
 *   this is a separate post-initialization screen: progress is effectively complete and the presenter only waits for the healthcheck response.
 *
 * - `wait-for-user-game-start`
 *   entered from `state-machine-transitioned`
 *   hides bootstrap progress and asks the user whether to start the game
 *   clicking the start button publishes `ui-restart-requested`, which the bootstrap machine is waiting for.
 *
 * Accepts:
 * - `app-static-resources-changed`
 * - `state-machine-transitioned`
 * - `app-status-changed`
 * - `provider-status-changed`
 * - `provider-selected`
 * - `provider-initialize-progress`
 * - `provider-initialize-completed`
 * - `provider-initialize-failed`
 * - `llm-response-received`
 * - `llm-request-failed`
 *
 * Emits:
 * - `app-resources-read-requested` when the language changes
 * - `ui-debug-toggle-requested` when the debug button is clicked
 * - `ui-reset-tree-requested` when the reset button is clicked
 * - `ui-restart-requested` when the start game button is clicked
 */
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
    this.startGameButtonElement = this.findById("start-game-button");
    this.debugToggleButtonElement = this.findById("debug-toggle-button");
    this.resetTreeButtonElement = this.findById("reset-tree-button");
    this.resources = null;
    this.currentScreen = SCREEN_BASE;
    this.initialize();
  }

  initialize() {
    if (!this.beginInitialize()) {
      return;
    }

    this.listen(this.languageSelectElement, "change", () => {
      this.publish(EventIds.appResourcesReadRequested, this.languageSelectElement.value);
    });

    this.listen(this.startGameButtonElement, "click", () => {
      this.publish(EventIds.uiRestartRequested, null);
    });

    this.listen(this.debugToggleButtonElement, "click", () => {
      this.publish(EventIds.uiDebugToggleRequested, null);
    });

    this.listen(this.resetTreeButtonElement, "click", () => {
      this.publish(EventIds.uiResetTreeRequested, null);
    });

    this.subscribeMany([
      {
        eventId: EventIds.appStaticResourcesChanged,
        handler: (resources) => {
          this.renderResources(resources);
          this.renderCurrentScreen();
        },
      },
      {
        eventId: EventIds.stateMachineTransitioned,
        handler: (message) => {
          this.handleStateMachineTransition(message);
        },
      },
      {
        eventId: EventIds.appStatusChanged,
        handler: (statusContext) => {
          this.renderStatus(statusContext);
        },
      },
      {
        eventId: EventIds.providerStatusChanged,
        handler: (message) => {
          this.renderProviderStatus(message);
        },
      },
      {
        eventId: EventIds.providerSelected,
        handler: (message) => {
          this.renderProviderSelection(message);
        },
      },
      {
        eventId: EventIds.providerInitializeProgress,
        handler: (message) => {
          this.renderProviderProgress(message);
        },
      },
      {
        eventId: EventIds.providerInitializeCompleted,
        handler: (message) => {
          this.renderProviderCompleted(message);
        },
      },
      {
        eventId: EventIds.providerInitializeFailed,
        handler: (message) => {
          this.renderProviderFailed(message);
        },
      },
      {
        eventId: EventIds.llmResponseReceived,
        handler: (message) => {
          this.renderLlmResponseReceived(message);
        },
      },
      {
        eventId: EventIds.llmRequestFailed,
        handler: (message) => {
          this.renderLlmRequestFailed(message);
        },
      },
    ]);

    this.renderCurrentScreen();
  }

  normalizeScreen(screenId) {
    if (screenId === SCREEN_VERIFY_PROVIDER || screenId === SCREEN_WAIT_FOR_PROVIDER) {
      return SCREEN_VERIFY_PROVIDER;
    }

    return screenId;
  }

  handleStateMachineTransition(message) {
    if (message?.machineId !== BOOTSTRAP_MACHINE_ID) {
      return;
    }

    const nextScreen = this.normalizeScreen(String(message?.currentNodeId || SCREEN_BASE));
    if (nextScreen === this.currentScreen) {
      return;
    }

    this.currentScreen = nextScreen;
    this.renderCurrentScreen();
  }

  renderResources(resources) {
    this.resources = resources;
    document.documentElement.lang = resources.locale;
    document.title = resources.ui.pageTitle;
    this.pageTitleElement.textContent = resources.ui.pageTitle;
    this.pageDescriptionElement.textContent = resources.ui.pageDescription;
    this.languageLabelElement.textContent = resources.ui.languageLabel;
    this.languageSelectElement.value = resources.locale;
    this.languageSelectElement.options[0].textContent = resources.ui.languages.en;
    this.languageSelectElement.options[1].textContent = resources.ui.languages.de;
    this.statusTitleElement.textContent = resources.ui.statusTitle;
    this.startGameButtonElement.textContent = resources.ui.startGameButton;
    this.debugToggleButtonElement.textContent = resources.ui.debugButton;
    this.resetTreeButtonElement.textContent = resources.ui.resetBaseButton;
  }

  renderCurrentScreen() {
    this.hideBootstrapActions();

    if (!this.resources) {
      this.renderStatus({ text: "Loading...", isError: false, progress: 0 });
      return;
    }

    if (this.currentScreen === SCREEN_BASE) {
      this.renderBaseScreen();
      return;
    }

    if (this.currentScreen === SCREEN_APPLY_STATIC_RESOURCES) {
      this.renderApplyStaticResourcesScreen();
      return;
    }

    if (this.currentScreen === SCREEN_VERIFY_PROVIDER) {
      this.renderVerifyProviderScreen();
      return;
    }

    if (this.currentScreen === SCREEN_PROVIDER_ERROR) {
      this.renderProviderErrorScreen();
      return;
    }

    if (this.currentScreen === SCREEN_SEND_PROVIDER_HEALTHCHECK) {
      this.renderSendProviderHealthcheckScreen();
      return;
    }

    if (this.currentScreen === SCREEN_WAIT_FOR_USER_GAME_START) {
      this.renderWaitForUserGameStartScreen();
    }
  }

  hideBootstrapActions() {
    this.startGameButtonElement.classList.add("hidden");
  }

  renderBaseScreen() {
    this.renderStatus({
      text: this.resources.status.loadingFallback,
      isError: false,
      progress: 0,
    });
  }

  renderApplyStaticResourcesScreen() {
    this.renderStatus({
      text: this.resources.status.loadingResources,
      isError: false,
      progress: 10,
    });
  }

  renderVerifyProviderScreen() {
    this.renderStatus({
      text: this.resources.status.checkingProviderStatus,
      isError: false,
      progress: 15,
    });
  }

  renderProviderErrorScreen() {
    this.renderStatus({
      text: this.statusElement.textContent || "Provider/bootstrap error.",
      isError: true,
      progress: 0,
    });
  }

  renderSendProviderHealthcheckScreen() {
    this.renderStatus({
      text: this.resources.status.sendingHelloPrompt,
      isError: false,
      progress: 100,
    });
  }

  renderWaitForUserGameStartScreen() {
    this.startGameButtonElement.classList.remove("hidden");
    this.renderStatus({
      text: this.resources.status.readyToStartGame,
      isError: false,
      progress: 0,
    });
  }

  renderStatus(statusContext) {
    const text = String(statusContext?.text || "");
    const isError = Boolean(statusContext?.isError);
    const progress = this.normalizeProgress(statusContext?.progress);

    this.statusElement.textContent = text;
    this.statusElement.classList.toggle("error", isError);
    this.progressBarElement.style.width = `${progress}%`;
  }

  renderProviderStatus(message) {
    if (!this.resources) {
      return;
    }

    if (message?.status === "error") {
      this.renderStatus({
        text: String(message?.error || "Provider error."),
        isError: true,
        progress: 0,
      });
      return;
    }

    if (this.currentScreen === SCREEN_VERIFY_PROVIDER && message?.status === "initializing") {
      this.renderVerifyProviderScreen();
      return;
    }

    if (this.currentScreen === SCREEN_WAIT_FOR_USER_GAME_START && message?.status === "ready") {
      this.renderWaitForUserGameStartScreen();
    }
  }

  renderProviderSelection(message) {
    if (!this.resources || !PROVIDER_PROGRESS_SCREENS.has(this.currentScreen)) {
      return;
    }

    const providerType = message?.providerType;
    const providerLabel = this.resources.providers.labels[providerType] || providerType || this.resources.providers.labels.local;
    this.renderStatus({
      text: this.resources.providers.status.loading(providerLabel),
      isError: false,
      progress: 8,
    });
  }

  renderProviderProgress(message) {
    if (!PROVIDER_PROGRESS_SCREENS.has(this.currentScreen)) {
      return;
    }

    this.renderStatus({
      text: message?.text || "",
      isError: false,
      progress: this.normalizeProgress(message?.progress),
    });
  }

  renderProviderCompleted(_message) {
    if (!this.resources || this.currentScreen !== SCREEN_SEND_PROVIDER_HEALTHCHECK) {
      return;
    }

    this.renderStatus({
      text: this.resources.status.modelLoaded,
      isError: false,
      progress: 100,
    });
  }

  renderProviderFailed(message) {
    this.renderStatus({
      text: String(message?.error || "Provider initialization failed."),
      isError: true,
      progress: 0,
    });
  }

  renderLlmResponseReceived(_message) {
    if (!this.resources || this.currentScreen !== SCREEN_SEND_PROVIDER_HEALTHCHECK) {
      return;
    }

    this.renderStatus({
      text: this.resources.status.modelLoaded,
      isError: false,
      progress: 100,
    });
  }

  renderLlmRequestFailed(message) {
    this.renderStatus({
      text: String(message?.error || "LLM request failed."),
      isError: true,
      progress: 0,
    });
  }

  normalizeProgress(progress) {
    if (typeof progress !== "number" || Number.isNaN(progress)) {
      return 0;
    }

    if (progress <= 1) {
      return Math.max(0, Math.min(100, Math.round(progress * 100)));
    }

    return Math.max(0, Math.min(100, Math.round(progress)));
  }
}
