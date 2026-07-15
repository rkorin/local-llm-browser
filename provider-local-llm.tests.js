import { ProviderLocalLlm } from "./provider-local-llm.js";
import {
  assert,
  assertArrayEqual,
  assertEqual,
  assertThrows,
  runTest,
} from "./tests.js";

const LOCAL_PROVIDER_MESSAGES = {
  notReady: "The LLM provider is not ready.",
  checkingRemoteFiles: "Loading local WebLLM provider...",
  loadingModel: "Loading...",
  webGpuUnavailable: "WebGPU is not available.",
  fileProtocolUnsupported: "file:// is not supported.",
  remoteConfigFetchFailed: (modelUrl, errorMessage) => `Config fetch failed for ${modelUrl}. ${errorMessage}`,
  remoteConfigUnavailable: (modelUrl) => `Config unavailable for ${modelUrl}.`,
  remoteLibraryFetchFailed: (libraryUrl, errorMessage) => `Library fetch failed for ${libraryUrl}. ${errorMessage}`,
  remoteLibraryUnavailable: (libraryUrl) => `Library unavailable for ${libraryUrl}.`,
};

function createLocalProvider({ engineContent = "engine reply", initializeError = null } = {}) {
  const progressEvents = [];
  const createCalls = [];
  const fakeEngine = {
    chat: {
      completions: {
        create: async ({ messages }) => ({
          choices: [
            {
              message: {
                content: typeof engineContent === "function" ? engineContent(messages) : engineContent,
              },
            },
          ],
        }),
      },
    },
  };
  const fakeWebllmModule = {
    CreateMLCEngine: async (modelId, options) => {
      createCalls.push({ modelId, options });
      if (initializeError) {
        throw initializeError;
      }
      options.initProgressCallback?.({ text: "Downloading weights", progress: 0.6 });
      return fakeEngine;
    },
  };
  const provider = new ProviderLocalLlm({
    modelId: "test-model-id",
    modelUrl: "https://models.example/test-model",
    modelLibUrl: "https://models.example/test-model.wasm",
    messages: LOCAL_PROVIDER_MESSAGES,
    webllmModule: fakeWebllmModule,
  });

  provider.assertBrowserSupport = async () => {};
  provider.assertRemoteFilesExist = async () => {};

  return {
    provider,
    progressEvents,
    createCalls,
    fakeEngine,
    async initialize() {
      await provider.initialize({
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });
    },
  };
}

export function runProviderLocalLlmTests() {
  return [
    // provider-local-llm-001: starts not ready
    runTest("provider-local-llm-001 starts not ready", async () => {
      const { provider } = createLocalProvider();

      assertEqual(provider.isReady(), false, "ProviderLocalLlm should start in a not-ready state");
    }),

    // provider-local-llm-002: complete fails before initialization
    runTest("provider-local-llm-002 complete fails before initialization", async () => {
      const { provider } = createLocalProvider();

      await assertThrowsAsync(
        () => provider.complete("hello"),
        "The LLM provider is not ready.",
      );
    }),

    // provider-local-llm-003: initialize emits local lifecycle progress and becomes ready
    runTest("provider-local-llm-003 initialize emits local lifecycle progress and becomes ready", async () => {
      const { provider, progressEvents, createCalls, initialize } = createLocalProvider();

      await initialize();

      assertEqual(provider.isReady(), true, "ProviderLocalLlm should be ready after initialize");
      assertEqual(createCalls.length, 1, "ProviderLocalLlm should create one WebLLM engine");
      assertEqual(createCalls[0].modelId, "test-model-id", "ProviderLocalLlm should pass modelId to CreateMLCEngine");
      assertEqual(createCalls[0].options.appConfig.model_list[0].model, "https://models.example/test-model", "ProviderLocalLlm should pass modelUrl into appConfig");
      assertEqual(createCalls[0].options.appConfig.model_list[0].model_lib, "https://models.example/test-model.wasm", "ProviderLocalLlm should pass modelLibUrl into appConfig");
      assertArrayEqual(
        progressEvents,
        [
          { text: "Loading local WebLLM provider...", progress: 0.12 },
          { text: "Loading...", progress: 0.2 },
          { text: "Downloading weights", progress: 0.6 },
        ],
        "ProviderLocalLlm should emit the expected progress lifecycle",
      );
    }),

    // provider-local-llm-004: complete returns string replies unchanged
    runTest("provider-local-llm-004 complete returns string replies unchanged", async () => {
      const { provider, initialize } = createLocalProvider({ engineContent: "plain string reply" });

      await initialize();

      const response = await provider.complete("hello world");

      assertEqual(response, "plain string reply", "ProviderLocalLlm should return plain string model replies unchanged");
    }),

    // provider-local-llm-005: complete stringifies structured replies
    runTest("provider-local-llm-005 complete stringifies structured replies", async () => {
      const { provider, initialize } = createLocalProvider({
        engineContent: { answer: "structured reply", confidence: 0.75 },
      });

      await initialize();

      const response = await provider.complete("hello structured");

      assertEqual(
        response,
        JSON.stringify({ answer: "structured reply", confidence: 0.75 }, null, 2),
        "ProviderLocalLlm should stringify non-string model replies",
      );
    }),

    // provider-local-llm-006: initialize surfaces WebLLM engine errors
    runTest("provider-local-llm-006 initialize surfaces WebLLM engine errors", async () => {
      const { initialize } = createLocalProvider({ initializeError: new Error("engine failed") });

      await assertThrowsAsync(
        () => initialize(),
        "engine failed",
      );
    }),
  ];
}

async function assertThrowsAsync(action, expectedMessagePart) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof Error,
      "Thrown value must be an Error instance.",
    );
    assert(
      error.message.includes(expectedMessagePart),
      `Expected error message to include "${expectedMessagePart}", got "${error.message}".`,
    );
    return;
  }

  throw new Error(`Expected exception including "${expectedMessagePart}".`);
}
