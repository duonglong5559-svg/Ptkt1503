import {
  Candle,
  SwingEngineInput,
  SwingEngineOutput,
  SwingPoint,
} from "../types";

const DEFAULT_LOOKBACK = 3;

export class SwingEngine {
  analyze(input: SwingEngineInput): SwingEngineOutput {
    const { candles, symbol, timeframe } = input;
    const lookback = input.lookback ?? DEFAULT_LOOKBACK;

    const closedCandles = candles.filter((c) => c.isClosed);
    if (closedCandles.length < lookback * 2 + 1) {
      return {
        symbol,
        timeframe,
        swingHighs: [],
        swingLows: [],
        allSwings: [],
      };
    }

    const swingHighs: SwingPoint[] = [];
    const swingLows: SwingPoint[] = [];

    for (let i = lookback; i < closedCandles.length - lookback; i++) {
      if (this.isSwingHigh(closedCandles, i, lookback)) {
        const strength = this.computeSwingStrength(
          closedCandles,
          i,
          lookback,
          "high"
        );
        swingHighs.push({
          type: "high",
          index: i,
          price: closedCandles[i].high,
          time: closedCandles[i].closeTime,
          strength,
        });
      }

      if (this.isSwingLow(closedCandles, i, lookback)) {
        const strength = this.computeSwingStrength(
          closedCandles,
          i,
          lookback,
          "low"
        );
        swingLows.push({
          type: "low",
          index: i,
          price: closedCandles[i].low,
          time: closedCandles[i].closeTime,
          strength,
        });
      }
    }

    const allSwings = [...swingHighs, ...swingLows].sort(
      (a, b) => a.index - b.index
    );

    return {
      symbol,
      timeframe,
      swingHighs,
      swingLows,
      allSwings,
      latestSwingHigh: swingHighs[swingHighs.length - 1],
      latestSwingLow: swingLows[swingLows.length - 1],
    };
  }

  private isSwingHigh(
    candles: Candle[],
    idx: number,
    lookback: number
  ): boolean {
    const candidateHigh = candles[idx].high;
    for (let j = 1; j <= lookback; j++) {
      if (candles[idx - j].high >= candidateHigh) return false;
      if (candles[idx + j].high >= candidateHigh) return false;
    }
    return true;
  }

  private isSwingLow(
    candles: Candle[],
    idx: number,
    lookback: number
  ): boolean {
    const candidateLow = candles[idx].low;
    for (let j = 1; j <= lookback; j++) {
      if (candles[idx - j].low <= candidateLow) return false;
      if (candles[idx + j].low <= candidateLow) return false;
    }
    return true;
  }

  private computeSwingStrength(
    candles: Candle[],
    idx: number,
    lookback: number,
    type: "high" | "low"
  ): number {
    let strength = 50;
    const extended = Math.min(lookback + 2, idx, candles.length - idx - 1);

    let extraConfirms = 0;
    for (let j = lookback + 1; j <= extended; j++) {
      if (type === "high" && candles[idx - j]?.high < candles[idx].high) {
        extraConfirms++;
      }
      if (type === "low" && candles[idx - j]?.low > candles[idx].low) {
        extraConfirms++;
      }
    }
    strength += extraConfirms * 8;

    const range = candles[idx].high - candles[idx].low;
    const avgRange = this.avgRange(candles, idx, 10);
    if (avgRange > 0 && range > avgRange * 1.2) {
      strength += 10;
    }

    return Math.min(100, strength);
  }

  private avgRange(candles: Candle[], idx: number, period: number): number {
    const start = Math.max(0, idx - period);
    let sum = 0;
    let count = 0;
    for (let i = start; i < idx; i++) {
      sum += candles[i].high - candles[i].low;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }
}
