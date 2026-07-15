import { EventIds } from "./event-ids.js";
import { EventMessageBus } from "./event-message-bus.js";
import { ProviderFactory } from "./provider-factory.js";
import { ResourceFactory } from "./resource-factory.js";
import {
  assert,
  assertArrayEqual,
  assertEqual,
  runTest,
} from "./tests.js";

let sourceCounter = 0;

function nextSourceId(prefix) {
  sourceCounter += 1;
  return `${prefix}:${sourceCounter}`;
}

function waitForEvent(eventBus, eventId) {
  return new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe(eventId, nextSourceId(`test:wait:${eventId}`), (event) => {
      unsubscribe();
      resolve(event);
    });
  });
}

function waitForEventWhere(eventBus, eventId, predicate) {
  return new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe(eventId, nextSourceId(`test:wait-where:${eventId}`), (event) => {
      if (!predicate(event)) {
        return;
      }

      unsubscribe();
      resolve(event);
    });
  });
}

function waitForEvents(eventBus, eventId, expectedCount) {
  return new Promise((resolve) => {
    const events = [];
    const unsubscribe = eventBus.subscribe(eventId, nextSourceId(`test:wait-many:${eventId}`), (event) => {
      events.push(event);
      if (events.length >= expectedCount) {
        unsubscribe();
        resolve(events);
      }
    });
  });
}

function captureSpecificEvents(eventBus, eventIds) {
  const events = [];
  const eventIdSet = new Set(eventIds);
  const unsubscribe = eventBus.subscribe("all", nextSourceId("test:capture:all"), (event) => {
    if (eventIdSet.has(event.id)) {
      events.push(event);
    }
  });

  return {
    events,
    stop() {
      unsubscribe();
    },
  };
}

async function bootstrapEchoProvider() {
  const eventBus = new EventMessageBus();
  const resourceFactory = new ResourceFactory(eventBus);
  const providerFactory = new ProviderFactory(eventBus);
  const selectedPromise = waitForEvent(eventBus, EventIds.providerSelected);
  const completedPromise = waitForEvent(eventBus, EventIds.providerInitializeCompleted);

  eventBus.publish(EventIds.appResourcesReadRequested, "en");
  eventBus.publish(EventIds.providerSelectRequested, "echo");

  const selectedEvent = await selectedPromise;
  const completedEvent = await completedPromise;

  return {
    eventBus,
    resourceFactory,
    providerFactory,
    selectedEvent,
    completedEvent,
  };
}

export function runProviderFactoryTests() {
  return [
    // provider-factory-001: constructor requires an event bus
    runTest("provider-factory-001 constructor requires an event bus", async () => {
      let actualMessage = "";

      try {
        new ProviderFactory();
      } catch (error) {
        actualMessage = error instanceof Error ? error.message : String(error);
      }

      assertEqual(actualMessage, "ProviderFactory requires an event bus.", "ProviderFactory should fail fast when eventBus is missing");
    }),

    // provider-factory-002: constructor starts in command-waiting mode
    runTest("provider-factory-002 constructor starts in command-waiting mode", async () => {
      const eventBus = new EventMessageBus();
      const providerFactory = new ProviderFactory(eventBus);

      assertEqual(providerFactory.resources, null, "ProviderFactory should start without localized resources");
      assertEqual(providerFactory.requestedProviderType, null, "ProviderFactory should start without a requested provider type");
      assertEqual(providerFactory.providerType, null, "ProviderFactory should not preselect a provider type");
      assertEqual(providerFactory.provider, null, "ProviderFactory should not create a provider before commands arrive");
    }),

    // provider-factory-003: resource updates are stored locally and refreshed dynamically
    runTest("provider-factory-003 resource updates are stored locally and refreshed dynamically", async () => {
      const eventBus = new EventMessageBus();
      const providerFactory = new ProviderFactory(eventBus);
      const firstResources = { locale: "en" };
      const secondResources = { locale: "de" };

      eventBus.publish(EventIds.appStaticResourcesChanged, firstResources);
      assertEqual(providerFactory.resources.locale, "en", "ProviderFactory should store the first resource update locally");

      eventBus.publish(EventIds.appStaticResourcesChanged, secondResources);
      assertEqual(providerFactory.resources.locale, "de", "ProviderFactory should replace local resources when a new update arrives");
    }),

    // provider-factory-004: resource load plus provider selection auto-starts the provider chain
    runTest("provider-factory-004 resource load plus provider selection auto-starts the provider chain", async () => {
      const { resourceFactory, providerFactory, selectedEvent, completedEvent } = await bootstrapEchoProvider();

      assertEqual(resourceFactory.resources.locale, "en", "ResourceFactory should load English resources for the provider flow");
      assertEqual(providerFactory.resources.locale, "en", "ProviderFactory should keep the latest localized resources locally");
      assertEqual(selectedEvent.message.providerType, "echo", "Provider selection event should carry echo provider type");
      assertEqual(completedEvent.message.providerType, "echo", "Provider initialization should complete automatically after selection");
      assertEqual(providerFactory.providerType, "echo", "ProviderFactory should normalize echo provider type");
      assertEqual(providerFactory.provider.constructor.name, "ProviderEcho", "ProviderFactory should create ProviderEcho");
    }),

    // provider-factory-005: echo provider selection emits the full lifecycle sequence automatically
    runTest("provider-factory-005 echo provider selection emits the full lifecycle sequence automatically", async () => {
      const eventBus = new EventMessageBus();
      const resourceFactory = new ResourceFactory(eventBus);
      const providerFactory = new ProviderFactory(eventBus);
      const lifecycleLog = captureSpecificEvents(eventBus, [
        EventIds.providerSelected,
        EventIds.providerInitializeProgress,
        EventIds.providerInitializeCompleted,
        EventIds.providerInitializeFailed,
      ]);
      const progressPromise = waitForEvents(eventBus, EventIds.providerInitializeProgress, 2);
      const completedPromise = waitForEvent(eventBus, EventIds.providerInitializeCompleted);

      eventBus.publish(EventIds.appResourcesReadRequested, "en");
      eventBus.publish(EventIds.providerSelectRequested, "echo");

      const progressEvents = await progressPromise;
      const completedEvent = await completedPromise;
      const lifecycleIds = lifecycleLog.events.map((event) => event.id);

      assertEqual(resourceFactory.resources.locale, "en", "ResourceFactory should still own the source resource object");
      assertArrayEqual(
        lifecycleIds,
        [
          EventIds.providerSelected,
          EventIds.providerInitializeProgress,
          EventIds.providerInitializeProgress,
          EventIds.providerInitializeCompleted,
        ],
        "Selecting a provider should automatically emit the full successful lifecycle",
      );
      assertEqual(providerFactory.providerType, "echo", "ProviderFactory should keep the selected provider type after auto-init");
      assertEqual(progressEvents.length, 2, "Echo initialization should emit two progress events");
      assertEqual(progressEvents[0].message.providerType, "echo", "First progress event should belong to echo provider");
      assertEqual(progressEvents[0].message.text, "Loading local WebLLM provider...", "First progress text should mirror local provider loading message");
      assertEqual(progressEvents[0].message.progress, 0.12, "First progress value should match local provider simulation");
      assertEqual(progressEvents[1].message.providerType, "echo", "Second progress event should belong to echo provider");
      assertEqual(progressEvents[1].message.text, "Loading...", "Second progress text should mirror local provider loading fallback");
      assertEqual(progressEvents[1].message.progress, 0.2, "Second progress value should match local provider simulation");
      assertEqual(completedEvent.message.providerType, "echo", "Initialization should complete for echo provider");
      assert(
        lifecycleLog.events.every((event) => event.id !== EventIds.providerInitializeFailed),
        "Auto-started echo initialization should not emit providerInitializeFailed.",
      );

      lifecycleLog.stop();
    }),

    // provider-factory-006: echo provider round-trips multiple prompts through app events after auto-init
    runTest("provider-factory-006 echo provider round-trips multiple prompts through app events after auto-init", async () => {
      const { eventBus, providerFactory } = await bootstrapEchoProvider();
      const requestLog = captureSpecificEvents(eventBus, [
        EventIds.llmResponseReceived,
        EventIds.llmRequestFailed,
      ]);
      const requestMessages = [
        "hello echo",
        { prompt: "What is the current node?" },
        { prompt: "Line 1\nLine 2\nLine 3" },
      ];
      const expectedPrompts = requestMessages.map((item) => typeof item === "string" ? item : item.prompt);

      assert(providerFactory.provider.isReady(), "Echo provider should be ready after automatic initialization.");

      const responses = [];
      for (const requestMessage of requestMessages) {
        const responsePromise = waitForEvent(eventBus, EventIds.llmResponseReceived);
        eventBus.publish(EventIds.llmRequestRequested, requestMessage);
        const responseEvent = await responsePromise;
        responses.push(responseEvent.message);
      }

      assertArrayEqual(
        responses.map((item) => item.providerType),
        ["echo", "echo", "echo"],
        "Every round-trip response should identify the echo provider",
      );
      assertArrayEqual(
        responses.map((item) => item.prompt),
        expectedPrompts,
        "Each llmResponseReceived event should keep the original prompt",
      );
      assertArrayEqual(
        responses.map((item) => item.response),
        expectedPrompts,
        "Echo provider should return each prompt unchanged",
      );
      assertEqual(
        requestLog.events.filter((event) => event.id === EventIds.llmResponseReceived).length,
        3,
        "Three prompts should produce three llmResponseReceived events",
      );
      assert(
        requestLog.events.every((event) => event.id !== EventIds.llmRequestFailed),
        "Echo request flow should not emit llmRequestFailed.",
      );

      requestLog.stop();
    }),

    // provider-factory-007: unknown provider does not fall back to local
    runTest("provider-factory-007 unknown provider does not fall back to local", async () => {
      const eventBus = new EventMessageBus();
      const resourceFactory = new ResourceFactory(eventBus);
      const providerFactory = new ProviderFactory(eventBus);
      const failedPromise = waitForEvent(eventBus, EventIds.providerInitializeFailed);

      eventBus.publish(EventIds.appResourcesReadRequested, "en");
      eventBus.publish(EventIds.providerSelectRequested, "unknown-provider");

      const failedEvent = await failedPromise;

      assertEqual(resourceFactory.resources.locale, "en", "ResourceFactory should still load resources before the provider failure");
      assertEqual(providerFactory.provider, null, "Unknown provider selection should not create a provider instance");
      assertEqual(providerFactory.providerType, null, "Unknown provider selection should not assign a provider type");
      assertEqual(failedEvent.message.providerType, "unknown-provider", "Failure event should report the requested provider type");
      assertEqual(failedEvent.message.error, "Unknown provider type: unknown-provider", "Failure event should expose a clear unknown provider error");
    }),

    // provider-factory-008: provider status request reports not-selected before configuration arrives
    runTest("provider-factory-008 provider status request reports not-selected before configuration arrives", async () => {
      const eventBus = new EventMessageBus();
      new ProviderFactory(eventBus);
      const statusPromise = waitForEventWhere(eventBus, EventIds.providerStatusChanged, (event) => event.message.status === "not-selected");

      eventBus.publish(EventIds.providerStatusRequested, null);
      const statusEvent = await statusPromise;

      assertEqual(statusEvent.message.status, "not-selected", "ProviderFactory should report not-selected before any provider selection");
      assertEqual(statusEvent.message.providerType, null, "ProviderFactory should not report an active provider type before selection");
    }),

    // provider-factory-009: provider status request reports ready after successful initialization
    runTest("provider-factory-009 provider status request reports ready after successful initialization", async () => {
      const { eventBus } = await bootstrapEchoProvider();
      const statusPromise = waitForEventWhere(eventBus, EventIds.providerStatusChanged, (event) => event.message.status === "ready");

      eventBus.publish(EventIds.providerStatusRequested, null);
      const statusEvent = await statusPromise;

      assertEqual(statusEvent.message.status, "ready", "ProviderFactory should report ready after successful initialization");
      assertEqual(statusEvent.message.providerType, "echo", "ProviderFactory should report the active provider type in ready status");
    }),

    // provider-factory-010: provider status stays initializing while the current init is still in progress
    runTest("provider-factory-010 provider status stays initializing while the current init is still in progress", async () => {
      const eventBus = new EventMessageBus();
      const providerFactory = new ProviderFactory(eventBus);
      const resources = {
        locale: "en",
        errors: { modelEngineNotReady: "not ready" },
        status: { loadingFallback: "Loading..." },
        providers: {
          labels: { local: "Local", echo: "Echo" },
          status: { loading: (label) => `Loading ${label}`, connectingOpenAi: "Connecting OpenAI" },
          errors: {
            noProviderSelected: "No provider selected.",
            unknownProviderType: (value) => `Unknown provider type: ${value}`,
            openAiBaseUrlMissing: "Missing baseUrl",
            openAiApiKeyMissing: "Missing apiKey",
            openAiModelMissing: "Missing model",
            openAiRequestFailed: () => "OpenAI request failed",
            openAiInvalidResponse: "OpenAI invalid response",
          },
        },
      };

      let releaseInitialize;
      const initializePromise = new Promise((resolve) => {
        releaseInitialize = resolve;
      });

      providerFactory.createProvider = () => ({
        async initialize() {
          await initializePromise;
        },
        async complete(prompt) {
          return prompt;
        },
      });

      eventBus.publish(EventIds.appStaticResourcesChanged, resources);
      eventBus.publish(EventIds.providerSelectRequested, "echo");

      const statusPromise = waitForEventWhere(eventBus, EventIds.providerStatusChanged, (event) => event.message.status === "initializing");
      eventBus.publish(EventIds.providerStatusRequested, null);
      const statusEvent = await statusPromise;

      assertEqual(statusEvent.message.status, "initializing", "ProviderFactory should report initializing while provider init is still in progress");
      assertEqual(statusEvent.message.requestedProviderType, "echo", "ProviderFactory should keep the requested provider in initializing status");

      releaseInitialize();
      await Promise.resolve();
      await Promise.resolve();
    }),

    // provider-factory-011: config changes during initialization restart the provider and ignore stale events
    runTest("provider-factory-011 config changes during initialization restart the provider and ignore stale events", async () => {
      const eventBus = new EventMessageBus();
      const providerFactory = new ProviderFactory(eventBus);
      const published = [];
      const capture = eventBus.subscribe("all", nextSourceId("test:restart:capture"), (event) => {
        if (
          event.id === EventIds.providerSelected
          || event.id === EventIds.providerInitializeProgress
          || event.id === EventIds.providerInitializeCompleted
          || event.id === EventIds.providerInitializeFailed
        ) {
          published.push(event);
        }
      });

      const firstResources = {
        locale: "en",
        errors: { modelEngineNotReady: "not ready" },
        status: { loadingFallback: "Loading..." },
        providers: {
          labels: { local: "Local", echo: "Echo" },
          status: { loading: (label) => `Loading ${label}` , connectingOpenAi: "Connecting OpenAI" },
          errors: {
            noProviderSelected: "No provider selected.",
            unknownProviderType: (value) => `Unknown provider type: ${value}`,
            openAiBaseUrlMissing: "Missing baseUrl",
            openAiApiKeyMissing: "Missing apiKey",
            openAiModelMissing: "Missing model",
            openAiRequestFailed: () => "OpenAI request failed",
            openAiInvalidResponse: "OpenAI invalid response",
          },
        },
      };
      const secondResources = {
        ...firstResources,
        locale: "de",
      };

      let firstInitializeResolve;
      let secondInitializeResolve;
      const firstInitializePromise = new Promise((resolve) => {
        firstInitializeResolve = resolve;
      });
      const secondInitializePromise = new Promise((resolve) => {
        secondInitializeResolve = resolve;
      });

      let createCount = 0;
      providerFactory.createProvider = (providerType) => {
        createCount += 1;
        const currentCreate = createCount;
        return {
          async initialize({ onProgress } = {}) {
            onProgress?.({ text: `progress-${currentCreate}`, progress: currentCreate / 10 });
            if (currentCreate === 1) {
              await firstInitializePromise;
              return;
            }
            await secondInitializePromise;
          },
          async complete(prompt) {
            return `${providerType}:${prompt}`;
          },
        };
      };

      eventBus.publish(EventIds.appStaticResourcesChanged, firstResources);
      eventBus.publish(EventIds.providerSelectRequested, "echo");
      eventBus.publish(EventIds.appStaticResourcesChanged, secondResources);
      secondInitializeResolve();
      await Promise.resolve();
      await Promise.resolve();
      firstInitializeResolve();
      await Promise.resolve();
      await Promise.resolve();

      const lifecycleIds = published.map((event) => event.id);
      assertArrayEqual(
        lifecycleIds,
        [
          EventIds.providerSelected,
          EventIds.providerInitializeProgress,
          EventIds.providerSelected,
          EventIds.providerInitializeProgress,
          EventIds.providerInitializeCompleted,
        ],
        "Config changes should restart provider initialization and suppress stale completion events",
      );
      assertEqual(published[0].message.providerType, "echo", "First selection should still publish the selected provider");
      assertEqual(published[1].message.text, "progress-1", "First initialization may emit progress before it becomes stale");
      assertEqual(published[3].message.text, "progress-2", "Second initialization should emit progress for the fresh config");
      assertEqual(published[4].message.providerType, "echo", "Only the fresh initialization should complete");
      assertEqual(providerFactory.resources.locale, "de", "ProviderFactory should retain the newest resources after restart");

      capture();
    }),
    // provider-factory-012: provider selection waits for resources and starts once they arrive
    runTest("provider-factory-012 provider selection waits for resources and starts once they arrive", async () => {
      const eventBus = new EventMessageBus();
      const resourceFactory = new ResourceFactory(eventBus);
      const providerFactory = new ProviderFactory(eventBus);
      const selectedPromise = waitForEvent(eventBus, EventIds.providerSelected);
      const completedPromise = waitForEvent(eventBus, EventIds.providerInitializeCompleted);

      eventBus.publish(EventIds.providerSelectRequested, "echo");
      assertEqual(providerFactory.provider, null, "ProviderFactory should stay idle until resources arrive");
      assertEqual(providerFactory.requestedProviderType, "echo", "ProviderFactory should remember the requested provider while waiting for resources");

      eventBus.publish(EventIds.appResourcesReadRequested, "en");

      const selectedEvent = await selectedPromise;
      const completedEvent = await completedPromise;

      assertEqual(resourceFactory.resources.locale, "en", "ResourceFactory should publish resources that unlock provider activation");
      assertEqual(selectedEvent.message.providerType, "echo", "Deferred provider selection should still publish providerSelected");
      assertEqual(completedEvent.message.providerType, "echo", "Deferred provider selection should still auto-complete initialization");
      assertEqual(providerFactory.providerType, "echo", "ProviderFactory should end with the deferred provider selected");
    }),
  ];
}
