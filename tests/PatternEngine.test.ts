import { PatternEngine } from "../src/engines/PatternEngine";
import { makeCandle, generateTrendCandles, AssertFn } from "./helpers";

export function testPatternEngine(assert: AssertFn) {
  const engine = new PatternEngine();

  // Test: detect doji
  {
    const candles = generateTrendCandles("up", 8, 100, 2);
    candles.push(
      makeCandle({ open: 116, high: 119, low: 113, close: 116.1 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });
    const doji = result.patterns.find((p) => p.pattern === "doji");
    assert(doji !== undefined, "Detects doji candle");
    if (doji) {
      assert(doji.direction !== undefined, "Doji has direction");
      assert(doji.strength > 0, "Doji has positive strength");
    }
  }

  // Test: detect hammer after downtrend
  {
    const candles = generateTrendCandles("down", 8, 120, 2);
    candles.push(
      makeCandle({ open: 104.5, high: 105, low: 98, close: 104.8 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });
    const hammer = result.patterns.find((p) => p.pattern === "hammer");
    assert(hammer !== undefined, "Detects hammer after downtrend");
    if (hammer) {
      assert(hammer.direction === "bullish", "Hammer direction is bullish");
      assert(hammer.strength >= 55, "Hammer after downtrend has boosted strength");
    }
  }

  // Test: detect shooting star after uptrend
  {
    const candles = generateTrendCandles("up", 8, 100, 2);
    candles.push(
      makeCandle({ open: 116.5, high: 123, low: 116, close: 116.2 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });
    const star = result.patterns.find((p) => p.pattern === "shooting_star");
    assert(star !== undefined, "Detects shooting star after uptrend");
    if (star) {
      assert(star.direction === "bearish", "Shooting star is bearish");
    }
  }

  // Test: detect bullish engulfing
  {
    const candles = generateTrendCandles("down", 6, 110, 2);
    candles.push(
      makeCandle({ open: 100, high: 100.2, low: 97, close: 97.5 })
    );
    candles.push(
      makeCandle({ open: 97, high: 102, low: 96.8, close: 101.5 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });
    const engulfing = result.patterns.find(
      (p) => p.pattern === "bullish_engulfing"
    );
    assert(engulfing !== undefined, "Detects bullish engulfing");
    if (engulfing) {
      assert(engulfing.direction === "bullish", "Bullish engulfing direction correct");
    }
  }

  // Test: detect bearish engulfing
  {
    const candles = generateTrendCandles("up", 6, 100, 2);
    candles.push(
      makeCandle({ open: 112, high: 115, low: 111.8, close: 114.5 })
    );
    candles.push(
      makeCandle({ open: 115, high: 115.5, low: 110, close: 111 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });
    const engulfing = result.patterns.find(
      (p) => p.pattern === "bearish_engulfing"
    );
    assert(engulfing !== undefined, "Detects bearish engulfing");
  }

  // Test: empty candles
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: [],
    });
    assert(result.patterns.length === 0, "No patterns from empty candles");
  }

  // Test: context boost with support
  {
    const candles = generateTrendCandles("down", 8, 120, 2);
    candles.push(
      makeCandle({ open: 104.5, high: 105, low: 98, close: 104.8 })
    );
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      nearestSupport: 104.0,
      atr: 3,
    });
    const hammer = result.patterns.find((p) => p.pattern === "hammer");
    assert(
      hammer !== undefined && hammer.contextBoost > 0,
      "Hammer near support gets context boost"
    );
  }
}
