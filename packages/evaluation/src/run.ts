import { runAllEvals } from "./scenarios.js";

const results = await runAllEvals();
let failed = 0;

console.log("\nKLM Evaluation Suite\n" + "=".repeat(40));

for (const r of results) {
  const icon = r.passed ? "PASS" : "FAIL";
  console.log(`${icon}  ${r.name}`);
  console.log(`      ${r.message}`);
  if (!r.passed) failed++;
}

console.log("=".repeat(40));
console.log(`${results.length - failed}/${results.length} passed\n`);

if (failed > 0) {
  process.exit(1);
}
