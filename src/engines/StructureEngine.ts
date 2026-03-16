import { SwingPoint, StructureState } from "../types";

export type StructureEngineInput = {
  symbol: string;
  timeframe: string;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  allSwings?: SwingPoint[];
  currentPrice: number;
};

export type StructureEngineOutput = {
  state: StructureState;
  description: string;
  isUptrend: boolean;
  isDowntrend: boolean;
  isRange: boolean;
  recentBreak?: "bullish_bos" | "bearish_bos" | "choch_up" | "choch_down";
};

export class StructureEngine {
  analyze(input: StructureEngineInput): StructureEngineOutput {
    const { currentPrice } = input;
    const orderedSwings = this.normalizeSwings(
      input.allSwings || [...input.swingHighs, ...input.swingLows]
    );
    const swingHighs = orderedSwings.filter((s) => s.type === "high");
    const swingLows = orderedSwings.filter((s) => s.type === "low");

    if (orderedSwings.length < 4 || swingHighs.length < 2 || swingLows.length < 2) {
      return {
        state: "range",
        description: "Insufficient swing data for structure analysis.",
        isUptrend: false,
        isDowntrend: false,
        isRange: true,
      };
    }

    const recentSequence = orderedSwings.slice(-8);
    const recentHighs = recentSequence.filter((s) => s.type === "high").slice(-3);
    const recentLows = recentSequence.filter((s) => s.type === "low").slice(-3);
    const lastSwing = recentSequence[recentSequence.length - 1];

    const lastHigh = recentHighs[recentHighs.length - 1];
    const prevHigh = recentHighs.length >= 2 ? recentHighs[recentHighs.length - 2] : undefined;
    const lastLow = recentLows[recentLows.length - 1];
    const prevLow = recentLows.length >= 2 ? recentLows[recentLows.length - 2] : undefined;

    if (!lastHigh || !prevHigh || !lastLow || !prevLow) {
      return {
        state: "range",
        description: "Insufficient alternating swing data for structure analysis.",
        isUptrend: false,
        isDowntrend: false,
        isRange: true,
      };
    }

    const higherHigh = lastHigh.price > prevHigh.price;
    const lowerHigh = lastHigh.price < prevHigh.price;
    const higherLow = lastLow.price > prevLow.price;
    const lowerLow = lastLow.price < prevLow.price;

    const wasDowntrend = lowerHigh && lowerLow;
    const wasUptrend = higherHigh && higherLow;

    if (currentPrice > prevHigh.price) {
      return {
        state: "breakout",
        description: `Break of structure bullish. Giá phá đỉnh ${prevHigh.price.toFixed(2)}.`,
        isUptrend: true,
        isDowntrend: false,
        isRange: false,
        recentBreak: wasDowntrend ? "choch_up" : "bullish_bos",
      };
    }

    if (currentPrice < prevLow.price) {
      return {
        state: "breakdown",
        description: `Break of structure bearish. Giá phá đáy ${prevLow.price.toFixed(2)}.`,
        isUptrend: false,
        isDowntrend: true,
        isRange: false,
        recentBreak: wasUptrend ? "choch_down" : "bearish_bos",
      };
    }

    if (wasUptrend) {
      const inRetestZone =
        lastSwing.type === "low" &&
        currentPrice >= lastLow.price &&
        currentPrice <= lastHigh.price;
      return {
        state: inRetestZone ? "retest_up" : "uptrend",
        description: inRetestZone
          ? `Xu hướng tăng đang retest vùng đáy cao hơn ${lastLow.price.toFixed(2)}.`
          : "Cấu trúc thị trường tăng: Đỉnh cao hơn, Đáy cao hơn.",
        isUptrend: true,
        isDowntrend: false,
        isRange: false,
      };
    }

    if (wasDowntrend) {
      const inRetestZone =
        lastSwing.type === "high" &&
        currentPrice <= lastHigh.price &&
        currentPrice >= lastLow.price;
      return {
        state: inRetestZone ? "retest_down" : "downtrend",
        description: inRetestZone
          ? `Xu hướng giảm đang retest vùng đỉnh thấp hơn ${lastHigh.price.toFixed(2)}.`
          : "Cấu trúc thị trường giảm: Đỉnh thấp hơn, Đáy thấp hơn.",
        isUptrend: false,
        isDowntrend: true,
        isRange: false,
      };
    }

    if ((higherHigh && lowerLow) || (lowerHigh && higherLow)) {
      return {
        state: "transition",
        description: "Market structure in transition. Mixed signals from swings.",
        isUptrend: false,
        isDowntrend: false,
        isRange: false,
      };
    }

    return {
      state: "range",
      description: "Market in consolidation range.",
      isUptrend: false,
      isDowntrend: false,
      isRange: true,
    };
  }

  private normalizeSwings(swings: SwingPoint[]): SwingPoint[] {
    const ordered = [...swings].sort((a, b) => a.index - b.index);
    const normalized: SwingPoint[] = [];

    for (const swing of ordered) {
      const previous = normalized[normalized.length - 1];
      if (!previous) {
        normalized.push(swing);
        continue;
      }

      if (previous.type === swing.type) {
        const replace =
          (swing.type === "high" && swing.price >= previous.price) ||
          (swing.type === "low" && swing.price <= previous.price);
        if (replace) normalized[normalized.length - 1] = swing;
        continue;
      }

      normalized.push(swing);
    }

    return normalized;
  }
}
