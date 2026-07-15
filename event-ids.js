export const EventIds = {
  
  /* localization */
  // Resource commands.
  appResourcesReadRequested: "app-resources-read-requested",

  // Resource updates.
  appStaticResourcesChanged: "app-static-resources-changed",

  /* tree repository */
  // Tree commands.
  treeRootReadRequested: "tree-root-read-requested",
  treeRootSaveRequested: "tree-root-save-requested",
  treeRootResetRequested: "tree-root-reset-requested",

  // Tree updates.
  treeRootLoaded: "tree-root-loaded",

  /* llm providers */
  // Provider commands.
  providerSelectRequested: "provider-select-requested",
  providerInitializeRequested: "provider-initialize-requested",
  providerStatusRequested: "provider-status-requested",
  llmRequestRequested: "llm-request-requested",

  // Provider updates.
  providerStatusChanged: "provider-status-changed",
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
  gameFinished: "game-finished",
  gameClosed: "game-closed",

  // State machine lifecycle updates.
  stateMachineTransitioned: "state-machine-transitioned",

  // Main screen UI commands.
  uiDebugToggleRequested: "ui-debug-toggle-requested",
  uiResetTreeRequested: "ui-reset-tree-requested",

  // Game UI commands.
  uiChoiceYes: "ui-choice-yes",
  uiChoiceNo: "ui-choice-no",
  uiAnimalSubmit: "ui-animal-submit",
  uiRestartRequested: "ui-restart-requested",
  uiGameRetryRequested: "ui-game-retry-requested",
  uiGameCloseRequested: "ui-game-close-requested",

  // Debug UI commands.
  uiDebugRerunRequested: "ui-debug-rerun-requested",

  // Game flow control.
  gameCancel: "game-cancel",
};
