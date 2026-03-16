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

  const orderedUptrend = [
    makeSwing("high", 2, 110),
    makeSwing("low", 5, 100),
    makeSwing("high", 8, 116),
    makeSwing("low", 11, 106),
    makeSwing("high", 14, 123),
    makeSwing("low", 17, 112),
  ];
  const orderedUptrendHighLast = [
    makeSwing("high", 2, 110),
    makeSwing("low", 5, 100),
    makeSwing("high", 8, 116),
    makeSwing("low", 11, 106),
    makeSwing("high", 14, 123),
  ];
  const orderedDowntrend = [
    makeSwing("low", 2, 100),
    makeSwing("high", 5, 110),
    makeSwing("low", 8, 94),
    makeSwing("high", 11, 104),
    makeSwing("low", 14, 88),
    makeSwing("high", 17, 98),
  ];
  const orderedDowntrendLowLast = [
    makeSwing("low", 2, 100),
    makeSwing("high", 5, 110),
    makeSwing("low", 8, 94),
    makeSwing("high", 11, 104),
    makeSwing("low", 14, 88),
  ];

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [makeSwing("high", 2, 110)],
      swingLows: [makeSwing("low", 4, 100)],
      allSwings: [makeSwing("high", 2, 110), makeSwing("low", 4, 100)],
      currentPrice: 105,
    });

    assert(result.state === "range", "Insufficient swings = range");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: orderedUptrendHighLast.filter((s) => s.type === "high"),
      swingLows: orderedUptrendHighLast.filter((s) => s.type === "low"),
      allSwings: orderedUptrendHighLast,
      currentPrice: 115,
    });

    assert(result.state === "uptrend", "Higher highs and higher lows = uptrend");
    assert(result.isUptrend, "Uptrend flag set");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: orderedDowntrendLowLast.filter((s) => s.type === "high"),
      swingLows: orderedDowntrendLowLast.filter((s) => s.type === "low"),
      allSwings: orderedDowntrendLowLast,
      currentPrice: 96,
    });

    assert(result.state === "downtrend", "Lower highs and lower lows = downtrend");
    assert(result.isDowntrend, "Downtrend flag set");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: [
        makeSwing("high", 2, 130),
        makeSwing("high", 8, 126),
        makeSwing("high", 14, 121),
      ],
      swingLows: [
        makeSwing("low", 5, 120),
        makeSwing("low", 11, 113),
        makeSwing("low", 17, 108),
      ],
      allSwings: [
        makeSwing("high", 2, 130),
        makeSwing("low", 5, 120),
        makeSwing("high", 8, 126),
        makeSwing("low", 11, 113),
        makeSwing("high", 14, 121),
        makeSwing("low", 17, 108),
      ],
      currentPrice: 128,
    });

    assert(result.state === "breakout", "Break above prior swing high = breakout");
    assert(result.recentBreak === "choch_up", "Bullish CHOCH flag set when downtrend breaks up");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: orderedUptrend.filter((s) => s.type === "high"),
      swingLows: orderedUptrend.filter((s) => s.type === "low"),
      allSwings: orderedUptrend,
      currentPrice: 104,
    });

    assert(result.state === "breakdown", "Break below prior swing low = breakdown");
    assert(result.recentBreak === "choch_down", "Bearish CHOCH flag set when uptrend breaks down");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: orderedUptrend.filter((s) => s.type === "high"),
      swingLows: orderedUptrend.filter((s) => s.type === "low"),
      allSwings: orderedUptrend,
      currentPrice: 113,
    });

    assert(result.state === "retest_up", "Uptrend pullback inside higher-low zone = retest_up");
  }

  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      swingHighs: orderedDowntrend.filter((s) => s.type === "high"),
      swingLows: orderedDowntrend.filter((s) => s.type === "low"),
      allSwings: orderedDowntrend,
      currentPrice: 94,
    });

    assert(result.state === "retest_down", "Downtrend pullback inside lower-high zone = retest_down");
  }
}
