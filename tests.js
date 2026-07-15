const DEFAULT_TEST_TIMEOUT_MS = 4000;

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected: ${expected}. Actual: ${actual}.`);
  }
}

export function assertArrayEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(`${message}. Expected: ${expectedJson}. Actual: ${actualJson}.`);
  }
}

export function assertThrows(action, expectedMessagePart) {
  try {
    action();
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

function createTimeoutPromise(name, timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Test timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
}

export function runTest(name, testFn) {
  return async function executeTest() {
    console.groupCollapsed(`[TEST START] ${name}`);

    try {
      await Promise.race([
        Promise.resolve().then(() => testFn()),
        createTimeoutPromise(name, DEFAULT_TEST_TIMEOUT_MS),
      ]);
      console.info(`[TEST PASS] ${name}`);
      console.groupEnd();
      return { name, passed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TEST FAIL] ${name}`, error);
      console.groupEnd();
      return {
        name,
        passed: false,
        error: message,
      };
    }
  };
}

function createSummaryLine(text, className) {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  return line;
}

export function renderTestResults({ summaryElement, resultsElement, results, suites = [] }) {
  const passedCount = results.filter((item) => item.passed).length;
  summaryElement.replaceChildren(
    createSummaryLine(`${passedCount}/${results.length} tests passed`, "summary-total"),
  );

  for (const suite of suites) {
    const suitePassedCount = suite.results.filter((item) => item.passed).length;
    summaryElement.append(
      createSummaryLine(
        `${suite.name} ${suitePassedCount} of ${suite.results.length} tests passed`,
        "summary-suite",
      ),
    );
  }

  resultsElement.replaceChildren();

  for (const result of results) {
    const article = document.createElement("article");
    article.className = `result ${result.passed ? "pass" : "fail"}`;

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = `${result.passed ? "PASS" : "FAIL"} - ${result.name}`;

    const message = document.createElement("div");
    message.className = "result-message";
    message.textContent = result.passed ? "Completed successfully." : result.error;

    article.append(title, message);
    resultsElement.append(article);
  }
}
