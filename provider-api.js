import { ProviderBase } from "./provider-base.js";

export class ProviderApi extends ProviderBase {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.messages = config.messages;
    this.ready = false;
  }

  isReady() {
    return this.ready;
  }

  async initialize({ onProgress } = {}) {
    if (!this.baseUrl) {
      throw new Error(this.messages.baseUrlMissing);
    }
    if (!this.apiKey) {
      throw new Error(this.messages.apiKeyMissing);
    }
    if (!this.model) {
      throw new Error(this.messages.modelMissing);
    }

    onProgress?.({ text: this.messages.connecting, progress: 0.25 });
    this.ready = true;
  }

  async complete(prompt) {
    if (!this.ready) {
      throw new Error(this.messages.notReady);
    }

    const response = await fetch(this.chatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(this.messages.requestFailed(response.status, details));
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }
    if (content !== undefined) {
      return JSON.stringify(content, null, 2);
    }
    throw new Error(this.messages.invalidResponse);
  }

  chatCompletionsUrl() {
    return `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }
}
