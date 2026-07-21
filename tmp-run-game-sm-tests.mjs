import { runGameStateMachineTests } from "./state-machine-game.tests.js";

const tests = runGameStateMachineTests();
const results = [];

for (const test of tests) {
  results.push(await test());
}

const failed = results.filter((item) => !item.passed);
if (failed.length > 0) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(results, null, 2));
