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

export function runTest(name, testFn) {
  try {
    testFn();
    return { name, passed: true };
  } catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderTestResults({ summaryElement, resultsElement, results }) {
  const passedCount = results.filter((item) => item.passed).length;
  summaryElement.textContent = `${passedCount}/${results.length} tests passed`;

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
