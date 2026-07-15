import { ProviderEcho } from "./provider-echo.js";
import {
  assertArrayEqual,
  assertEqual,
  runTest,
} from "./tests.js";

const ECHO_PROVIDER_MESSAGES = {
  notReady: "The LLM provider is not ready.",
  checkingRemoteFiles: "Loading local WebLLM provider...",
  loadingModel: "Loading...",
};

async function assertThrowsAsync(action, expectedMessagePart) {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("Thrown value must be an Error instance.");
    }
    if (!error.message.includes(expectedMessagePart)) {
      throw new Error(`Expected error message to include "${expectedMessagePart}", got "${error.message}".`);
    }
    return;
  }

  throw new Error(`Expected exception including "${expectedMessagePart}".`);
}

export function runProviderEchoTests() {
  return [
    // provider-echo-001: starts not ready
    runTest("provider-echo-001 starts not ready", async () => {
      const provider = new ProviderEcho({ messages: ECHO_PROVIDER_MESSAGES });

      assertEqual(provider.isReady(), false, "ProviderEcho should start in a not-ready state");
    }),

    // provider-echo-002: complete fails before initialization
    runTest("provider-echo-002 complete fails before initialization", async () => {
      const provider = new ProviderEcho({ messages: ECHO_PROVIDER_MESSAGES });

      await assertThrowsAsync(
        () => provider.complete("hello"),
        "The LLM provider is not ready.",
      );
    }),

    // provider-echo-003: initialize emits local-like lifecycle progress and becomes ready
    runTest("provider-echo-003 initialize emits local-like lifecycle progress and becomes ready", async () => {
      const provider = new ProviderEcho({ messages: ECHO_PROVIDER_MESSAGES });
      const progressEvents = [];

      await provider.initialize({
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      });

      assertEqual(provider.isReady(), true, "ProviderEcho should be ready after initialize");
      assertArrayEqual(
        progressEvents,
        [
          { text: "Loading local WebLLM provider...", progress: 0.12 },
          { text: "Loading...", progress: 0.2 },
        ],
        "ProviderEcho should mirror the local provider progress contract",
      );
    }),

    // provider-echo-004: complete returns the prompt unchanged
    runTest("provider-echo-004 complete returns the prompt unchanged", async () => {
      const provider = new ProviderEcho({ messages: ECHO_PROVIDER_MESSAGES });

      await provider.initialize();

      const response = await provider.complete("Echo this exactly.");

      assertEqual(response, "Echo this exactly.", "ProviderEcho should return the original prompt unchanged");
    }),
  ];
}
