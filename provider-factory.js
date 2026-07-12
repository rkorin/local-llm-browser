import { ProviderLocalLlm } from "./provider-local-llm.js";
import { ProviderApi } from "./provider-api.js";
import { EventIds } from "./event-ids.js";

const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
const MODEL_URL = "https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC";
const MODEL_LIB_URL = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm";
const DEFAULT_PROVIDER_TYPE = "local";
const PROVIDER_TYPE_ALIASES = {
  local: "local",
  openai: "openai",
  openia: "openai",
};

export class ProviderFactory {
  constructor(eventBus, resourceFactory) {
    this.eventBus = eventBus;
    this.resourceFactory = resourceFactory;
    this.resources = resourceFactory?.resources || null;
    this.providerType = DEFAULT_PROVIDER_TYPE;
    this.provider = null;

    if (this.eventBus) {
      this.eventBus.subscribe(EventIds.appStaticResourcesChanged, (event) => {
        this.resources = event.message || null;
        if (this.provider) {
          this.provider = this.createProvider(this.providerType);
        }
      });

      this.eventBus.subscribe(EventIds.providerSelectRequested, (event) => {
        this.handleProviderSelected(event.message);
      });

      this.eventBus.subscribe(EventIds.providerInitializeRequested, async () => {
        await this.handleProviderInitializeRequested();
      });

      this.eventBus.subscribe(EventIds.llmRequestRequested, async (event) => {
        await this.handleLlmRequest(event.message);
      });
    }
  }

  normalizeProviderType(providerType) {
    const normalized = String(providerType ?? "").trim().toLowerCase();
    return PROVIDER_TYPE_ALIASES[normalized] || DEFAULT_PROVIDER_TYPE;
  }

  resolveProviderType(providerType = DEFAULT_PROVIDER_TYPE) {
    return this.normalizeProviderType(providerType);
  }

  requireResources() {
    if (!this.resources) {
      throw new Error("ProviderFactory requires resources before selecting a provider.");
    }
  }

  createProvider(providerType = DEFAULT_PROVIDER_TYPE) {
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

    return new ProviderLocalLlm({
      modelId: MODEL_ID,
      modelUrl: MODEL_URL,
      modelLibUrl: MODEL_LIB_URL,
      messages: {
        notReady: this.resources.errors.modelEngineNotReady,
        checkingRemoteFiles: this.resources.providers.status.loading(this.resources.providers.labels.local),
        loadingModel: this.resources.status.loadingFallback,
        webGpuUnavailable: this.resources.errors.webGpuUnavailable,
        fileProtocolUnsupported: this.resources.errors.fileProtocolUnsupported,
        remoteConfigFetchFailed: this.resources.errors.remoteConfigFetchFailed,
        remoteConfigUnavailable: this.resources.errors.remoteConfigUnavailable,
        remoteLibraryFetchFailed: this.resources.errors.remoteLibraryFetchFailed,
        remoteLibraryUnavailable: this.resources.errors.remoteLibraryUnavailable,
      },
    });
  }

  handleProviderSelected(providerType) {
    this.providerType = this.resolveProviderType(providerType);
    this.provider = this.createProvider(this.providerType);
    this.eventBus.publish(EventIds.providerSelected, {
      providerType: this.providerType,
    });
  }

  async handleProviderInitializeRequested() {
    if (!this.provider) {
      this.handleProviderSelected(this.providerType);
    }

    try {
      await this.provider.initialize({
        onProgress: (progress) => {
          this.eventBus.publish(EventIds.providerInitializeProgress, {
            providerType: this.providerType,
            text: progress?.text || "",
            progress: progress?.progress,
          });
        },
      });

      this.eventBus.publish(EventIds.providerInitializeCompleted, {
        providerType: this.providerType,
      });
    } catch (error) {
      this.eventBus.publish(EventIds.providerInitializeFailed, {
        providerType: this.providerType,
        error: this.errorMessage(error),
      });
    }
  }

  async handleLlmRequest(message) {
    const prompt = typeof message === "string" ? message : message?.prompt;

    if (!this.provider) {
      this.handleProviderSelected(this.providerType);
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
