import { Candle, SwingPoint, StructureState } from "../types";

export type StructureEngineInput = {
  symbol: string;
  timeframe: string;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
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
    const { swingHighs, swingLows, currentPrice } = input;

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return {
        state: "range",
        description: "Insufficient swing data for structure analysis.",
        isUptrend: false,
        isDowntrend: false,
        isRange: true,
      };
    }

    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);

    const hhCount = this.countHigherHighs(recentHighs);
    const hlCount = this.countHigherLows(recentLows);
    const lhCount = this.countLowerHighs(recentHighs);
    const llCount = this.countLowerLows(recentLows);

    const lastHigh = recentHighs[recentHighs.length - 1];
    const prevHigh = recentHighs.length >= 2 ? recentHighs[recentHighs.length - 2] : null;
    const lastLow = recentLows[recentLows.length - 1];
    const prevLow = recentLows.length >= 2 ? recentLows[recentLows.length - 2] : null;

    let recentBreak: StructureEngineOutput["recentBreak"];

    if (prevLow && currentPrice < prevLow.price && hhCount > 0) {
      return {
        state: "breakdown",
        description: `Break of structure bearish. Giá phá đáy ${prevLow.price.toFixed(2)}.`,
        isUptrend: false,
        isDowntrend: true,
        isRange: false,
        recentBreak: "bearish_bos",
      };
    }

    if (prevHigh && currentPrice > prevHigh.price && llCount > 0) {
      return {
        state: "breakout",
        description: `Break of structure bullish. Giá phá đỉnh ${prevHigh.price.toFixed(2)}.`,
        isUptrend: true,
        isDowntrend: false,
        isRange: false,
        recentBreak: "bullish_bos",
      };
    }

    if (hhCount >= 1 && hlCount >= 1) {
      return {
        state: "HH-HL",
        description: "Market structure bullish: Higher Highs and Higher Lows.",
        isUptrend: true,
        isDowntrend: false,
        isRange: false,
      };
    }

    if (lhCount >= 1 && llCount >= 1) {
      return {
        state: "LH-LL",
        description: "Market structure bearish: Lower Highs and Lower Lows.",
        isUptrend: false,
        isDowntrend: true,
        isRange: false,
      };
    }

    if (
      (hhCount >= 1 && llCount >= 1) ||
      (lhCount >= 1 && hlCount >= 1)
    ) {
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

  private countHigherHighs(highs: SwingPoint[]): number {
    let count = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) count++;
    }
    return count;
  }

  private countHigherLows(lows: SwingPoint[]): number {
    let count = 0;
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price > lows[i - 1].price) count++;
    }
    return count;
  }

  private countLowerHighs(highs: SwingPoint[]): number {
    let count = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price < highs[i - 1].price) count++;
    }
    return count;
  }

  private countLowerLows(lows: SwingPoint[]): number {
    let count = 0;
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price < lows[i - 1].price) count++;
    }
    return count;
  }
}
