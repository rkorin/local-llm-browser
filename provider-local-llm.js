import * as webllm from "https://esm.run/@mlc-ai/web-llm";

import { ProviderBase } from "./provider-base.js";

export class ProviderLocalLlm extends ProviderBase {
  constructor(config) {
    super(config);
    this.modelId = config.modelId;
    this.modelUrl = config.modelUrl;
    this.modelLibUrl = config.modelLibUrl;
    this.messages = config.messages;
    this.webllmModule = config.webllmModule || webllm;
    this.engine = null;
  }

  isReady() {
    return this.engine !== null;
  }

  async initialize({ onProgress } = {}) {
    await this.assertBrowserSupport();
    onProgress?.({ text: this.messages.checkingRemoteFiles, progress: 0.12 });
    await this.assertRemoteFilesExist();
    onProgress?.({ text: this.messages.loadingModel, progress: 0.2 });

    const appConfig = {
      cacheBackend: "cache",
      model_list: [
        {
          model: this.modelUrl,
          model_id: this.modelId,
          model_lib: this.modelLibUrl,
        },
      ],
    };

    this.engine = await this.webllmModule.CreateMLCEngine(this.modelId, {
      appConfig,
      initProgressCallback: (progress) => {
        onProgress?.(progress);
      },
    });
  }

  async complete(prompt) {
    if (!this.engine) {
      throw new Error(this.messages.notReady);
    }

    const reply = await this.engine.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = reply?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }
    return JSON.stringify(content, null, 2);
  }

  async assertBrowserSupport() {
    if (!("gpu" in navigator)) {
      throw new Error(this.messages.webGpuUnavailable);
    }
  }

  async assertRemoteFilesExist() {
    if (window.location.protocol === "file:") {
      throw new Error(this.messages.fileProtocolUnsupported);
    }

    let configResponse;
    try {
      configResponse = await fetch(`${this.modelUrl}/resolve/main/mlc-chat-config.json`, { method: "GET" });
    } catch (error) {
      throw new Error(this.messages.remoteConfigFetchFailed(this.modelUrl, this.errorMessage(error)));
    }
    if (!configResponse.ok) {
      throw new Error(this.messages.remoteConfigUnavailable(this.modelUrl));
    }

    let wasmResponse;
    try {
      wasmResponse = await fetch(this.modelLibUrl, { method: "GET" });
    } catch (error) {
      throw new Error(this.messages.remoteLibraryFetchFailed(this.modelLibUrl, this.errorMessage(error)));
    }
    if (!wasmResponse.ok) {
      throw new Error(this.messages.remoteLibraryUnavailable(this.modelLibUrl));
    }
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
}
