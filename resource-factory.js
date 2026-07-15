import { EnglishResources } from "./resources.js";
import { GermanResources } from "./resources.de.js";
import { EventIds } from "./event-ids.js";

const DEFAULT_LANGUAGE = "en";
const LANGUAGE_ALIASES = {
  ang: "en",
  angl: "en",
  english: "en",
  en: "en",
  de: "de",
  german: "de",
  deutsch: "de",
};

/**
 * Loads localized static resources, picks the language, caches the result,
 * and exposes it through globals plus the event bus.
 *
 * Accepts:
 * - `app-resources-read-requested` with an optional language code or alias.
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
    return LANGUAGE_ALIASES[normalized] || this.resolveLanguage();
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
    window.resources = loadedResources;
    window.resourceLanguage = loadedResources.locale;
    return loadedResources;
  }

  resolveResources(language = this.resolveLanguage()) {
    const loadedResources = this.loadResources(language);
    this.resources = loadedResources;
    this.eventBus.publish(EventIds.appStaticResourcesChanged, loadedResources);
    return loadedResources;
  }
}