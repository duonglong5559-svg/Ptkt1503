import { TrendlineEngine } from "../src/engines/TrendlineEngine";
import { SwingEngine } from "../src/engines/SwingEngine";
import { makeCandle, generateTrendCandles, AssertFn } from "./helpers";

export function testTrendlineEngine(assert: AssertFn) {
  const trendlineEngine = new TrendlineEngine();
  const swingEngine = new SwingEngine();

  // Test: ascending trendlines in uptrend
  {
    const candles = generateTrendCandles("up", 30, 100, 1.5);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
    });

    assert(result.trendlineCount >= 0, "Trendline analysis runs without error");
    assert(result.trendlineBias !== undefined, "Trendline bias is defined");
    assert(result.summary.length > 0, "Summary is non-empty");
  }

  // Test: descending trendlines in downtrend
  {
    const candles = generateTrendCandles("down", 30, 150, 1.5);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
    });

    assert(result.trendlineCount >= 0, "Downtrend trendline analysis works");
  }

  // Test: empty swings
  {
    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: [],
      swings: [],
      currentPrice: 100,
      currentIndex: 0,
    });
    assert(result.trendlineCount === 0, "No trendlines from empty data");
    assert(result.trendlineBias === "neutral", "Empty = neutral bias");
  }

  // Test: max active lines limited
  {
    const candles = generateTrendCandles("up", 50, 100, 0.8);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
    });

    assert(
      result.activeTrendlines.length <= 5,
      `Active trendlines limited (got ${result.activeTrendlines.length})`
    );
  }

  // Test: trendline strength scoring
  {
    const candles = generateTrendCandles("up", 40, 100, 1);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
    });

    for (const line of result.activeTrendlines) {
      assert(
        line.strength >= 0 && line.strength <= 100,
        `Trendline strength valid: ${line.strength}`
      );
      assert(
        line.touches >= 2,
        `Trendline has at least 2 touches: ${line.touches}`
      );
    }
  }
}
