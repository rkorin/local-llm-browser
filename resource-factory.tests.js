import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { ResourceFactory } from "./resource-factory.js";
import { EnglishResources } from "./resources.js";
import { GermanResources } from "./resources.de.js";
import {
  assert,
  assertEqual,
  runTest,
} from "./tests.js";

function withBrowserContext({ search = "", navigatorLanguage = "en-US" }, action) {
  const currentUrl = new URL(window.location.href);
  const restoreUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  const nextUrl = `${currentUrl.pathname}${search}${currentUrl.hash}`;
  const hadOwnLanguage = Object.prototype.hasOwnProperty.call(window.navigator, "language");
  const originalLanguageDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "language");

  window.history.replaceState(null, "", nextUrl);
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: navigatorLanguage,
  });

  try {
    return action();
  } finally {
    window.history.replaceState(null, "", restoreUrl);

    if (hadOwnLanguage && originalLanguageDescriptor) {
      Object.defineProperty(window.navigator, "language", originalLanguageDescriptor);
    } else {
      delete window.navigator.language;
    }
  }
}

export function runResourceFactoryTests() {
  return [
    // resource-factory-001: constructor requires an event bus
    runTest("resource-factory-001 constructor requires an event bus", () => {
      let actualMessage = "";

      try {
        new ResourceFactory();
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "ResourceFactory requires an event bus.", "ResourceFactory should fail fast when eventBus is missing");
    }),

    // resource-factory-002: create resource factory
    runTest("resource-factory-002 create resource factory", () => {
      const eventBus = new EventMessageBus();
      const factory = new ResourceFactory(eventBus);

      assert(factory instanceof ResourceFactory, "Expected a new ResourceFactory instance.");
      assertEqual(factory.resources, null, "Factory should start without cached resources");
    }),

    // resource-factory-003: resolve language prefers explicit URL query
    runTest("resource-factory-003 resolve language prefers explicit URL query", () => {
      withBrowserContext({ search: "?lang=de", navigatorLanguage: "en-US" }, () => {
        const factory = new ResourceFactory(new EventMessageBus());

        assertEqual(factory.resolveLanguage(), "de", "Query parameter should override browser language");
      });
    }),

    // resource-factory-004: resolve language falls back to browser locale
    runTest("resource-factory-004 resolve language falls back to browser locale", () => {
      withBrowserContext({ search: "?lang=unsupported", navigatorLanguage: "de-DE" }, () => {
        const factory = new ResourceFactory(new EventMessageBus());

        assertEqual(factory.resolveLanguage(), "de", "German browser locale should resolve to de");
      });
    }),

    // resource-factory-005: normalize language supports canonical codes and fallback
    runTest("resource-factory-005 normalize language supports canonical codes and fallback", () => {
      withBrowserContext({ search: "?lang=en", navigatorLanguage: "de-DE" }, () => {
        const factory = new ResourceFactory(new EventMessageBus());

        assertEqual(factory.normalizeLanguage("en"), "en", "English UI code should remain en");
        assertEqual(factory.normalizeLanguage("de"), "de", "German UI code should remain de");
        assertEqual(factory.normalizeLanguage("unknown-language"), "en", "Unknown language should use the resolved language fallback");
      });
    }),
    // resource-factory-006: create resource provider returns matching class
    runTest("resource-factory-006 create resource provider returns matching class", () => {
      const factory = new ResourceFactory(new EventMessageBus());

      assert(factory.createResourceProvider("en") instanceof EnglishResources, "en should create EnglishResources");
      assert(factory.createResourceProvider("de") instanceof GermanResources, "de should create GermanResources");
    }),

    // resource-factory-007: load resources returns the selected locale
    runTest("resource-factory-007 load resources returns the selected locale", () => {
      const factory = new ResourceFactory(new EventMessageBus());
      const loadedResources = factory.loadResources("de");

      assertEqual(loadedResources.locale, "de", "German UI code should load German resources");
    }),

    // resource-factory-008: resolve resources publishes and caches result
    runTest("resource-factory-008 resolve resources publishes and caches result", () => {
        const eventBus = new EventMessageBus();
        const factory = new ResourceFactory(eventBus);
        let publishedResources = null;

        eventBus.subscribe(EventIds.appStaticResourcesChanged, "test:resource-factory:resolved", (event) => {
          publishedResources = event.message;
        });

        const resolvedResources = factory.resolveResources("en");

        assert(factory.resources === resolvedResources, "Factory should cache the resolved resources.");
        assert(publishedResources === resolvedResources, "Resolved resources should be published on the event bus.");
        assertEqual(resolvedResources.locale, "en", "Explicit en should resolve English resources");
    }),

    // resource-factory-009: resource read request event triggers resolution
    runTest("resource-factory-009 resource read request event triggers resolution", () => {
        const eventBus = new EventMessageBus();
        const factory = new ResourceFactory(eventBus);
        let publishedResources = null;

        eventBus.subscribe(EventIds.appStaticResourcesChanged, "test:resource-factory:requested", (event) => {
          publishedResources = event.message;
        });

        eventBus.publish(EventIds.appResourcesReadRequested, "de");

        assert(factory.resources !== null, "Factory should resolve resources after read request event.");
        assert(factory.resources === publishedResources, "Published resources should match factory cache.");
        assertEqual(factory.resources.locale, "de", "Read request should resolve requested locale");
    }),
  ];
}