import { EventMessageBus } from "./event-message-bus.js";
import {
  assert,
  assertEqual,
  runTest,
} from "./tests.js";
import { PresenterBase } from "./presenter-base.js";

class TestPresenter extends PresenterBase {}

function createRoot(id = "presenter-base-test-root") {
  const root = document.createElement("div");
  root.id = id;
  root.innerHTML = '<button id="test-button" type="button">Click</button><div id="status"></div>';
  document.body.appendChild(root);
  return root;
}

function removeRoot(root) {
  root.remove();
}

export function runPresenterBaseTests() {
  return [
    // presenter-base-001: subscribe forwards event message and event metadata
    runTest("presenter-base-001 subscribe forwards event message and event metadata", async () => {
      const root = createRoot();
      const eventBus = new EventMessageBus();
      const presenter = new TestPresenter({ rootId: root.id, eventBus });
      let receivedMessage = null;
      let receivedEventId = null;

      presenter.subscribe("all", (message, event) => {
        receivedMessage = message;
        receivedEventId = event.id;
      });

      eventBus.publish("ui-debug-toggle-requested", { ok: true });

      assertEqual(JSON.stringify(receivedMessage), JSON.stringify({ ok: true }), "PresenterBase should forward event.message to subscriber handlers");
      assertEqual(receivedEventId, "ui-debug-toggle-requested", "PresenterBase should forward the original event object");

      presenter.dispose();
      removeRoot(root);
    }),

    // presenter-base-002: listen registers DOM listener and dispose removes it
    runTest("presenter-base-002 listen registers DOM listener and dispose removes it", async () => {
      const root = createRoot();
      const eventBus = new EventMessageBus();
      const presenter = new TestPresenter({ rootId: root.id, eventBus });
      const button = presenter.findById("test-button");
      let clicks = 0;

      presenter.listen(button, "click", () => {
        clicks += 1;
      });

      button.click();
      presenter.dispose();
      button.click();

      assertEqual(clicks, 1, "PresenterBase.dispose should remove registered DOM listeners");

      removeRoot(root);
    }),
  ];
}