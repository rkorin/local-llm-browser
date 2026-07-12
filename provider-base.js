export class ProviderBase {
  constructor(config = {}) {
    this.messages = config.messages || {};
  }

  isReady() {
    return false;
  }

  async initialize(_options = {}) {
    throw new Error("ProviderBase.initialize must be implemented by subclasses.");
  }

  async complete(_prompt) {
    throw new Error("ProviderBase.complete must be implemented by subclasses.");
  }
}
