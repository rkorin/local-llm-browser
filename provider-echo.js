import { ProviderBase } from "./provider-base.js";

export class ProviderEcho extends ProviderBase {
  constructor(config) {
    super(config);
    this.messages = config.messages;
    this.ready = false;
  }

  isReady() {
    return this.ready;
  }

  async initialize({ onProgress } = {}) {
    onProgress?.({ text: this.messages.checkingRemoteFiles, progress: 0.12 });
    await this.nextTick();
    onProgress?.({ text: this.messages.loadingModel, progress: 0.2 });
    await this.nextTick();
    this.ready = true;
  }

  async complete(prompt) {
    if (!this.ready) {
      throw new Error(this.messages.notReady);
    }

    return String(prompt ?? "");
  }

  nextTick() {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}
