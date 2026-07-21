import { EnglishResources } from "./resources.js";
import { GermanResources } from "./resources.de.js";
import { EventIds } from "./event-ids.js";

export const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = new Set(["en", "de"]);

/**
 * Loads localized static resources, picks the language, caches the result,
 * and exposes it through the event bus.
 *
 * Accepts:
 * - `app-resources-read-requested` with a supported language code: `en` or `de`.
 *
 * Emits:
 * - `app-static-resources-changed` with the resolved resources object.
 */
export class ResourceFactory {
  constructor(eventBus) {
    if (!eventBus) {
      throw new Error("ResourceFactory requires an event bus.");
    }

    this.eventBus = eventBus;
    this.resources = null;
    this.subscriptionSourceId = "ResourceFactory";

    this.eventBus.subscribe(EventIds.appResourcesReadRequested, this.subscriptionSourceId, (event) => {
      this.resolveResources(event.message);
    });
  }

  resolveLanguage() {
    const urlLanguage = new URLSearchParams(window.location.search).get("lang")?.toLowerCase();
    if (urlLanguage === "de" || urlLanguage === "en") {
      return urlLanguage;
    }

    const browserLanguage = navigator.language?.toLowerCase() || DEFAULT_LANGUAGE;
    return browserLanguage.startsWith("de") ? "de" : DEFAULT_LANGUAGE;
  }

  normalizeLanguage(language) {
    const normalized = String(language ?? "").trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : this.resolveLanguage();
  }

  createResourceProvider(language = this.resolveLanguage()) {
    if (language === "de") {
      return new GermanResources();
    }
    return new EnglishResources();
  }

  loadResources(language = this.resolveLanguage()) {
    const provider = this.createResourceProvider(this.normalizeLanguage(language));
    const loadedResources = provider.getResources();
    return loadedResources;
  }

  resolveResources(language = this.resolveLanguage()) {
    const loadedResources = this.loadResources(language);
    this.resources = loadedResources;
    this.eventBus.publish(EventIds.appStaticResourcesChanged, loadedResources);
    return loadedResources;
  }
}