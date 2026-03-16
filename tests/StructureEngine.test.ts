import { StructureEngine } from "../src/engines/StructureEngine";
import { AssertFn } from "./helpers";
import { SwingPoint } from "../src/types";

function makeSwing(
  type: "high" | "low",
  index: number,
  price: number
): SwingPoint {
  return {
    type,
    index,
    price,
    time: Date.now() + index * 3600000,
    strength: 60,
  };
}

export function testStructureEngine(assert: AssertFn) {
  const engine = new StructureEngine();

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 110)],
      swingLows: [makeSwing("low", 4, 100)],
      currentPrice: 105,
    });

    assert(result.state === "range", "Insufficient swings = range");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 110), makeSwing("high", 8, 116), makeSwing("high", 14, 123)],
      swingLows: [makeSwing("low", 5, 100), makeSwing("low", 11, 106), makeSwing("low", 17, 112)],
      currentPrice: 120,
    });

    assert(result.state === "uptrend", "Higher highs and higher lows = uptrend");
    assert(result.isUptrend, "Uptrend flag set");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 130), makeSwing("high", 8, 124), makeSwing("high", 14, 118)],
      swingLows: [makeSwing("low", 5, 120), makeSwing("low", 11, 114), makeSwing("low", 17, 108)],
      currentPrice: 110,
    });

    assert(result.state === "downtrend", "Lower highs and lower lows = downtrend");
    assert(result.isDowntrend, "Downtrend flag set");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 130), makeSwing("high", 8, 126), makeSwing("high", 14, 121)],
      swingLows: [makeSwing("low", 5, 120), makeSwing("low", 11, 113), makeSwing("low", 17, 108)],
      currentPrice: 128,
    });

    assert(result.state === "breakout", "Break above prior swing high = breakout");
    assert(result.recentBreak === "bullish_bos", "Bullish BOS flag set");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 110), makeSwing("high", 8, 116), makeSwing("high", 14, 121)],
      swingLows: [makeSwing("low", 5, 100), makeSwing("low", 11, 106), makeSwing("low", 17, 112)],
      currentPrice: 104,
    });

    assert(result.state === "breakdown", "Break below prior swing low = breakdown");
    assert(result.recentBreak === "bearish_bos", "Bearish BOS flag set");
  }
}
