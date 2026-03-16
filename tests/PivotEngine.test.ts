import { PivotEngine } from "../src/engines/PivotEngine";
import { AssertFn } from "./helpers";

export function testPivotEngine(assert: AssertFn) {
  const engine = new PivotEngine();

  // Test: basic pivot calculation
  {
    const levels = engine.computeLevels(110, 90, 100);
    assert(levels.pivot === 100, "Pivot = (110+90+100)/3 = 100");
    assert(levels.r1 === 110, "R1 = 2*100-90 = 110");
    assert(levels.s1 === 90, "S1 = 2*100-110 = 90");
    assert(levels.r2 === 120, "R2 = 100+(110-90) = 120");
    assert(levels.s2 === 80, "S2 = 100-(110-90) = 80");
  }

  // Test: below pivot state
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 95,
    });
    assert(result.state === "below_pivot", "Price 95 is below pivot 100");
    assert(result.directionBias === "bearish", "Below pivot = bearish bias");
    assert(result.targetHint === 100, "Target hint is pivot level");
    assert(result.narrative.includes("dưới Pivot"), "Narrative mentions below pivot");
  }

  // Test: above pivot state
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 105,
    });
    assert(result.state === "above_pivot", "Price 105 is above pivot 100");
    assert(result.directionBias === "bullish", "Above pivot = bullish bias");
  }

  // Test: at pivot state
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 100.1,
    });
    assert(result.state === "at_pivot", "Price ~100 is at pivot 100");
    assert(result.directionBias === "neutral", "At pivot = neutral");
  }

  // Test: approaching pivot from below with rising momentum
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 99.7,
      momentum: "rising",
    });
    assert(
      result.state === "approaching_pivot_from_below",
      "Rising momentum near pivot from below"
    );
  }

  // Test: nearest support/resistance
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 5200,
      low: 5050,
      close: 5150,
      currentPrice: 5120,
    });
    assert(result.nearestSupport < 5120, "Nearest support is below current price");
    assert(result.nearestResistance > 5120, "Nearest resistance is above current price");
  }

  // Test: no resistance above highest pivot level
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 135,
    });
    assert(result.nearestResistance === undefined, "No nearest resistance when price is above r3");
    assert(result.nearestSupport !== undefined && result.nearestSupport < 135, "Nearest support still exists below price");
  }

  // Test: no support below lowest pivot level
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      sourceTimeframe: "1d",
      high: 110,
      low: 90,
      close: 100,
      currentPrice: 65,
    });
    assert(result.nearestSupport === undefined, "No nearest support when price is below s3");
    assert(result.nearestResistance !== undefined && result.nearestResistance > 65, "Nearest resistance still exists above price");
  }
}
