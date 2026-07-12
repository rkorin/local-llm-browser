export const EventIds = {
  
  /* localization */
  // Resource commands.
  appResourcesReadRequested: "app-resources-read-requested",

  // Resource updates.
  appStaticResourcesChanged: "app-static-resources-changed",

  /* llm providers */
  // Provider commands.
  providerSelectRequested: "provider-select-requested",
  providerInitializeRequested: "provider-initialize-requested",
  llmRequestRequested: "llm-request-requested",

  // Provider updates.
  providerSelected: "provider-selected",
  providerInitializeProgress: "provider-initialize-progress",
  providerInitializeCompleted: "provider-initialize-completed",
  providerInitializeFailed: "provider-initialize-failed",
  llmResponseReceived: "llm-response-received",
  llmRequestFailed: "llm-request-failed",


  /* others */
  // Core presentation updates.
  appStatusChanged: "app-status-changed",
  gameContextChanged: "game-context-changed",
  debugContextChanged: "debug-context-changed",

  // Main screen UI commands.
  uiDebugToggleRequested: "ui-debug-toggle-requested",
  uiResetTreeRequested: "ui-reset-tree-requested",

  // Game UI commands.
  uiChoiceYes: "ui-choice-yes",
  uiChoiceNo: "ui-choice-no",
  uiAnimalSubmit: "ui-animal-submit",
  uiRestartRequested: "ui-restart-requested",

  // Debug UI commands.
  uiDebugRerunRequested: "ui-debug-rerun-requested",

  // Game flow control.
  gameCancel: "game-cancel",
};
