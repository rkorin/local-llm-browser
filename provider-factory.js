import { ProviderLocalLlm } from "./provider-local-llm.js";
import { ProviderApi } from "./provider-api.js";
import { ProviderEcho } from "./provider-echo.js";
import { EventIds } from "./event-ids.js";

const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
const MODEL_URL = "https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC";
const MODEL_LIB_URL = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm";
const PROVIDER_TYPE_ALIASES = {
  local: "local",
  echo: "echo",
  openai: "openai",
  openia: "openai",
};

/**
 * Keeps the latest provider config from independent bus events, manages
 * the active LLM provider lifecycle, and exposes provider status through events.
 *
 * Accepts:
 * - `app-static-resources-changed` stores the latest localized resources.
 * - `provider-select-requested` stores the latest requested provider type.
 * - `provider-status-requested` emits the current provider status snapshot.
 * - `llm-request-requested` sends a prompt through the active provider.
 *
 * Behavior:
 * - The factory waits until it has both resources and a selected provider.
 * - As soon as both are present, it creates and initializes the provider.
 * - If resources change or the selected provider changes, the old init becomes stale
 *   and the factory restarts with the new effective config.
 *
 * Emits:
 * - `provider-status-changed` with provider status: `not-selected`, `initializing`, `ready`, or `error`.
 * - `provider-selected` when a provider instance is chosen for the current config.
 * - `provider-initialize-progress` while the current provider is initializing.
 * - `provider-initialize-completed` when the current provider becomes ready.
 * - `provider-initialize-failed` when provider creation or init fails.
 * - `llm-response-received` when the active provider returns a response.
 * - `llm-request-failed` when a prompt cannot be completed.
 */
export class ProviderFactory {
  constructor(eventBus) {
    if (!eventBus) {
      throw new Error("ProviderFactory requires an event bus.");
    }

    this.eventBus = eventBus;
    this.resources = null;
    this.requestedProviderType = null;
    this.providerType = null;
    this.provider = null;
    this.providerStatus = "not-selected";
    this.providerStatusError = "";
    this.subscriptionSourceBase = "ProviderFactory";
    this.configRevision = 0;
    this.activeInitializationRevision = 0;
    this.lastActivatedConfigKey = null;

    this.eventBus.subscribe(EventIds.appStaticResourcesChanged, `${this.subscriptionSourceBase}:resources`, async (event) => {
      this.resources = event.message || null;
      this.bumpConfigRevision();
      await this.reconcileProviderState();
    });

    this.eventBus.subscribe(EventIds.providerSelectRequested, `${this.subscriptionSourceBase}:select`, async (event) => {
      this.requestedProviderType = event.message;
      this.bumpConfigRevision();
      await this.reconcileProviderState();
    });

    this.eventBus.subscribe(EventIds.providerStatusRequested, `${this.subscriptionSourceBase}:status`, () => {
      this.publishProviderStatus();
    });

    this.eventBus.subscribe(EventIds.llmRequestRequested, `${this.subscriptionSourceBase}:request`, async (event) => {
      await this.handleLlmRequest(event.message);
    });
  }

  bumpConfigRevision() {
    this.configRevision += 1;
  }

  setProviderStatus(status, error = "") {
    this.providerStatus = status;
    this.providerStatusError = error;
    this.publishProviderStatus();
  }

  publishProviderStatus() {
    this.eventBus.publish(EventIds.providerStatusChanged, {
      status: this.providerStatus,
      providerType: this.providerType,
      requestedProviderType: this.requestedProviderType,
      error: this.providerStatusError,
    });
  }

  normalizeProviderType(providerType) {
    const normalized = String(providerType ?? "").trim().toLowerCase();
    return PROVIDER_TYPE_ALIASES[normalized] || null;
  }

  resolveProviderType(providerType) {
    const resolvedProviderType = this.normalizeProviderType(providerType);
    if (resolvedProviderType) {
      return resolvedProviderType;
    }

    if (providerType === null || providerType === undefined || String(providerType).trim() === "") {
      if (this.resources?.providers?.errors?.noProviderSelected) {
        throw new Error(this.resources.providers.errors.noProviderSelected);
      }
      throw new Error("No provider selected.");
    }

    if (this.resources?.providers?.errors?.unknownProviderType) {
      throw new Error(this.resources.providers.errors.unknownProviderType(providerType));
    }

    throw new Error(`Unknown provider type: ${providerType}`);
  }

  requireResources() {
    if (!this.resources) {
      throw new Error("ProviderFactory requires resources before selecting a provider.");
    }
  }

  createLocalLikeMessages() {
    return {
      notReady: this.resources.errors.modelEngineNotReady,
      checkingRemoteFiles: this.resources.providers.status.loading(this.resources.providers.labels.local),
      loadingModel: this.resources.status.loadingFallback,
      webGpuUnavailable: this.resources.errors.webGpuUnavailable,
      fileProtocolUnsupported: this.resources.errors.fileProtocolUnsupported,
      remoteConfigFetchFailed: this.resources.errors.remoteConfigFetchFailed,
      remoteConfigUnavailable: this.resources.errors.remoteConfigUnavailable,
      remoteLibraryFetchFailed: this.resources.errors.remoteLibraryFetchFailed,
      remoteLibraryUnavailable: this.resources.errors.remoteLibraryUnavailable,
    };
  }

  createProvider(providerType) {
    this.requireResources();
    const resolvedProviderType = this.resolveProviderType(providerType);

    if (resolvedProviderType === "openai") {
      return new ProviderApi({
        baseUrl: "",
        apiKey: "",
        model: "",
        messages: {
          notReady: this.resources.errors.modelEngineNotReady,
          connecting: this.resources.providers.status.connectingOpenAi,
          baseUrlMissing: this.resources.providers.errors.openAiBaseUrlMissing,
          apiKeyMissing: this.resources.providers.errors.openAiApiKeyMissing,
          modelMissing: this.resources.providers.errors.openAiModelMissing,
          requestFailed: this.resources.providers.errors.openAiRequestFailed,
          invalidResponse: this.resources.providers.errors.openAiInvalidResponse,
        },
      });
    }

    if (resolvedProviderType === "echo") {
      return new ProviderEcho({
        messages: this.createLocalLikeMessages(),
      });
    }

    return new ProviderLocalLlm({
      modelId: MODEL_ID,
      modelUrl: MODEL_URL,
      modelLibUrl: MODEL_LIB_URL,
      messages: this.createLocalLikeMessages(),
    });
  }

  effectiveConfigAvailable() {
    return this.resources !== null && this.resources !== undefined
      && this.requestedProviderType !== null && this.requestedProviderType !== undefined;
  }

  currentConfigKey() {
    if (!this.effectiveConfigAvailable()) {
      return null;
    }

    const locale = this.resources?.locale || "unknown-locale";
    return `${String(this.requestedProviderType)}::${locale}`;
  }

  async reconcileProviderState() {
    if (!this.requestedProviderType) {
      this.provider = null;
      this.providerType = null;
      this.lastActivatedConfigKey = null;
      this.setProviderStatus("not-selected");
      return;
    }

    if (!this.resources) {
      this.provider = null;
      this.providerType = null;
      this.lastActivatedConfigKey = null;
      this.setProviderStatus("initializing");
      return;
    }

    const revision = this.configRevision;
    const configKey = this.currentConfigKey();
    if (!configKey) {
      this.setProviderStatus("not-selected");
      return;
    }

    this.provider = null;
    this.providerType = null;
    this.setProviderStatus("initializing");

    try {
      const nextProviderType = this.resolveProviderType(this.requestedProviderType);
      if (revision !== this.configRevision) {
        return;
      }

      const nextProvider = this.createProvider(nextProviderType);
      if (revision !== this.configRevision) {
        return;
      }

      this.providerType = nextProviderType;
      this.provider = nextProvider;
      this.activeInitializationRevision = revision;
      this.lastActivatedConfigKey = configKey;

      this.eventBus.publish(EventIds.providerSelected, {
        providerType: this.providerType,
      });

      await this.initializeActiveProvider(revision, configKey, nextProvider);
    } catch (error) {
      if (revision !== this.configRevision) {
        return;
      }

      this.provider = null;
      this.providerType = null;
      this.lastActivatedConfigKey = null;
      this.setProviderStatus("error", this.errorMessage(error));
      this.eventBus.publish(EventIds.providerInitializeFailed, {
        providerType: String(this.requestedProviderType ?? ""),
        error: this.errorMessage(error),
      });
    }
  }

  async initializeActiveProvider(revision, configKey, provider) {
    if (!this.providerType) {
      const error = this.resources?.providers?.errors?.noProviderSelected || "No provider selected.";
      this.setProviderStatus("not-selected", error);
      this.eventBus.publish(EventIds.providerInitializeFailed, {
        providerType: "",
        error,
      });
      return;
    }

    if (!provider) {
      throw new Error("ProviderFactory requires an active provider before initialization.");
    }

    try {
      await provider.initialize({
        onProgress: (progress) => {
          if (!this.isCurrentInitialization(revision, configKey, provider)) {
            return;
          }

          this.eventBus.publish(EventIds.providerInitializeProgress, {
            providerType: this.providerType,
            text: progress?.text || "",
            progress: progress?.progress,
          });
        },
      });

      if (!this.isCurrentInitialization(revision, configKey, provider)) {
        return;
      }

      this.setProviderStatus("ready");
      this.eventBus.publish(EventIds.providerInitializeCompleted, {
        providerType: this.providerType,
      });
    } catch (error) {
      if (!this.isCurrentInitialization(revision, configKey, provider)) {
        return;
      }

      this.provider = null;
      this.setProviderStatus("error", this.errorMessage(error));
      this.eventBus.publish(EventIds.providerInitializeFailed, {
        providerType: this.providerType,
        error: this.errorMessage(error),
      });
    }
  }

  isCurrentInitialization(revision, configKey, provider) {
    return revision === this.configRevision
      && revision === this.activeInitializationRevision
      && configKey === this.lastActivatedConfigKey
      && provider === this.provider;
  }

  async handleLlmRequest(message) {
    const prompt = typeof message === "string" ? message : message?.prompt;

    if (!this.providerType) {
      this.eventBus.publish(EventIds.llmRequestFailed, {
        providerType: "",
        prompt,
        error: this.resources?.providers?.errors?.noProviderSelected || "No provider selected.",
      });
      return;
    }

    if (!this.provider) {
      this.eventBus.publish(EventIds.llmRequestFailed, {
        providerType: this.providerType,
        prompt,
        error: this.resources?.errors?.modelEngineNotReady || "The LLM provider is not ready.",
      });
      return;
    }

    try {
      const response = await this.provider.complete(prompt);
      this.eventBus.publish(EventIds.llmResponseReceived, {
        providerType: this.providerType,
        prompt,
        response,
      });
    } catch (error) {
      this.eventBus.publish(EventIds.llmRequestFailed, {
        providerType: this.providerType,
        prompt,
        error: this.errorMessage(error),
      });
    }
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
}
