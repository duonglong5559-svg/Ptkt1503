import { testPatternEngine } from "./PatternEngine.test";
import { testPivotEngine } from "./PivotEngine.test";
import { testSwingEngine } from "./SwingEngine.test";
import { testTrendlineEngine } from "./TrendlineEngine.test";
import { testStructureEngine } from "./StructureEngine.test";
import { testScoringEngine } from "./ScoringEngine.test";
import { testSignalEngine } from "./SignalEngine.test";
import { testPipeline } from "./Pipeline.test";
import { testFeedHealth } from "./FeedHealth.test";
import { testSymbolMapping } from "./SymbolMapping.test";
import { testCandleConfirmation } from "./CandleConfirmation.test";
import { testSignalSanity } from "./SignalSanity.test";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

async function run() {
  console.log("\n=== PTKT Engine Test Suite ===\n");

  console.log("▸ PatternEngine");
  testPatternEngine(assert);

  console.log("\n▸ PivotEngine");
  testPivotEngine(assert);

  console.log("\n▸ SwingEngine");
  testSwingEngine(assert);

  console.log("\n▸ TrendlineEngine");
  testTrendlineEngine(assert);

  console.log("\n▸ StructureEngine");
  testStructureEngine(assert);

  console.log("\n▸ ScoringEngine");
  testScoringEngine(assert);

  console.log("\n▸ SignalEngine");
  testSignalEngine(assert);

  console.log("\n▸ Pipeline (integration)");
  testPipeline(assert);

  console.log("\n▸ FeedHealth");
  testFeedHealth(assert);

  console.log("\n▸ SymbolMapping");
  testSymbolMapping(assert);

  console.log("\n▸ CandleConfirmation");
  testCandleConfirmation(assert);

  console.log("\n▸ SignalSanity");
  testSignalSanity(assert);

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"=".repeat(40)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
