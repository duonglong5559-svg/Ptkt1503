import {
  SignalEngineInput,
  TradingSignal,
  SignalState,
  TimeframeScore,
  PivotRelation,
  TrendlineEngineOutput,
} from "../types";

const WATCH_THRESHOLD = 58;
const READY_THRESHOLD = 62;
const COOLDOWN_MS = 5 * 60 * 1000;
const ATR_BUFFER_MULT = 0.5;
const RR_MIN = 1.2;

export class SignalEngine {
  evaluate(input: SignalEngineInput): TradingSignal {
    const {
      symbol,
      globalLongPercent,
      globalShortPercent,
      previousSignal,
      currentTime,
      currentPrice,
    } = input;

    if (previousSignal?.cooldownUntil && currentTime < previousSignal.cooldownUntil) {
      return {
        ...previousSignal,
        state: "idle",
        summaryText: "Đang trong thời gian cooldown. Chờ điều kiện mới.",
        updatedAt: currentTime,
      };
    }

    const state = this.resolveState(input, previousSignal);
    const direction = this.resolveDirection(state);

    const entryLong = this.computeEntryLong(input);
    const entryShort = this.computeEntryShort(input);
    const stopLoss = this.computeStopLoss(input, direction);
    const takeProfit = this.computeTakeProfit(input, direction, entryLong, entryShort, stopLoss);
    const target = this.computeTarget(input, direction);

    const rr = this.computeRR(
      direction,
      direction === "long" ? entryLong : entryShort,
      stopLoss,
      takeProfit
    );

    const invalidationReason = this.checkInvalidation(input, state, previousSignal);
    const finalState: SignalState = invalidationReason ? "invalidated" : state;

    const summaryText = this.buildSummary(input, finalState, direction, entryLong, entryShort, target);
    const detailText = this.buildDetails(input, finalState, direction, entryLong, entryShort, stopLoss, takeProfit, target);

    const cooldownUntil =
      finalState === "invalidated"
        ? currentTime + COOLDOWN_MS
        : previousSignal?.cooldownUntil;

    return {
      symbol,
      state: finalState,
      direction,
      confidenceLong: globalLongPercent,
      confidenceShort: globalShortPercent,
      entryLong,
      entryShort,
      stopLoss,
      takeProfit,
      target,
      riskRewardRatio: rr,
      invalidationReason,
      summaryText,
      detailText,
      updatedAt: currentTime,
      cooldownUntil,
    };
  }

  private resolveState(
    input: SignalEngineInput,
    prev?: TradingSignal
  ): SignalState {
    const {
      globalLongPercent,
      globalShortPercent,
      timeframeScores,
      pivotRelation,
      trendlineOutput,
      currentPrice,
      atr,
    } = input;

    const bigFramesBearish = this.countBigFramesBias(timeframeScores, "bearish");
    const bigFramesBullish = this.countBigFramesBias(timeframeScores, "bullish");

    const canWatchShort =
      globalShortPercent >= WATCH_THRESHOLD &&
      bigFramesBearish >= 2 &&
      (pivotRelation.directionBias === "bearish" ||
        pivotRelation.state === "below_pivot" ||
        pivotRelation.state === "rejected_from_pivot");

    const canWatchLong =
      globalLongPercent >= WATCH_THRESHOLD &&
      bigFramesBullish >= 2 &&
      (pivotRelation.directionBias === "bullish" ||
        pivotRelation.state === "above_pivot");

    const hasResistanceNearby = trendlineOutput.activeTrendlines.some(
      (t) =>
        t.type === "descending_resistance" &&
        !t.isBroken &&
        t.distanceToPricePercent < 1.0
    );

    const hasSupportNearby = trendlineOutput.activeTrendlines.some(
      (t) =>
        t.type === "ascending_support" &&
        !t.isBroken &&
        t.distanceToPricePercent < 1.0
    );

    if (canWatchShort && globalShortPercent >= READY_THRESHOLD) {
      if (hasResistanceNearby || input.nearestResistance !== undefined) {
        const resistDist = input.nearestResistance
          ? Math.abs(currentPrice - input.nearestResistance)
          : Infinity;
        const atrVal = atr || Infinity;
        if (resistDist < atrVal * 1.5 || hasResistanceNearby) {
          return "ready_short";
        }
      }
      return "watch_short";
    }

    if (canWatchLong && globalLongPercent >= READY_THRESHOLD) {
      if (hasSupportNearby || input.nearestSupport !== undefined) {
        const supDist = input.nearestSupport
          ? Math.abs(currentPrice - input.nearestSupport)
          : Infinity;
        const atrVal = atr || Infinity;
        if (supDist < atrVal * 1.5 || hasSupportNearby) {
          return "ready_long";
        }
      }
      return "watch_long";
    }

    if (canWatchShort) return "watch_short";
    if (canWatchLong) return "watch_long";

    return "idle";
  }

  private resolveDirection(
    state: SignalState
  ): "long" | "short" | "neutral" {
    if (state.includes("long")) return "long";
    if (state.includes("short")) return "short";
    return "neutral";
  }

  private countBigFramesBias(
    scores: TimeframeScore[],
    bias: "bullish" | "bearish"
  ): number {
    const bigFrames = ["4h", "6h", "8h", "12h", "1d", "1w"];
    return scores.filter(
      (s) => bigFrames.includes(s.timeframe) && s.dominantBias === bias
    ).length;
  }

  private computeEntryLong(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestSupport, pivotRelation, atr } = input;

    const candidates: number[] = [];

    if (nearestSupport) {
      candidates.push(nearestSupport);
    }

    if (pivotRelation.state === "below_pivot") {
      const pullbackEntry = pivotRelation.levels.s1;
      if (pullbackEntry < currentPrice) {
        candidates.push(pullbackEntry);
      }
    }

    const supportTL = input.trendlineOutput.activeTrendlines.find(
      (t) =>
        t.type === "ascending_support" &&
        !t.isBroken &&
        t.distanceToPrice > 0 &&
        t.distanceToPricePercent < 2
    );
    if (supportTL) {
      const projected = supportTL.slope * (input.trendlineOutput.activeTrendlines.length) + supportTL.intercept;
      if (projected > 0 && projected < currentPrice) {
        candidates.push(Math.round(projected * 100) / 100);
      }
    }

    if (candidates.length === 0) {
      const offset = (atr || currentPrice * 0.005) * 0.8;
      return Math.round((currentPrice - offset) * 100) / 100;
    }

    candidates.sort((a, b) => b - a);
    return Math.round(candidates[0] * 100) / 100;
  }

  private computeEntryShort(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestResistance, pivotRelation, atr } = input;

    const candidates: number[] = [];

    if (nearestResistance) {
      candidates.push(nearestResistance);
    }

    if (pivotRelation.state === "above_pivot" || pivotRelation.state === "approaching_pivot_from_below") {
      candidates.push(pivotRelation.levels.pivot);
    }
    if (pivotRelation.levels.r1 > currentPrice) {
      candidates.push(pivotRelation.levels.r1);
    }

    const resistTL = input.trendlineOutput.activeTrendlines.find(
      (t) =>
        t.type === "descending_resistance" &&
        !t.isBroken &&
        t.distanceToPrice > 0 &&
        t.distanceToPricePercent < 2
    );
    if (resistTL) {
      const projected = resistTL.slope * (input.trendlineOutput.activeTrendlines.length) + resistTL.intercept;
      if (projected > currentPrice) {
        candidates.push(Math.round(projected * 100) / 100);
      }
    }

    if (candidates.length === 0) {
      const offset = (atr || currentPrice * 0.005) * 0.8;
      return Math.round((currentPrice + offset) * 100) / 100;
    }

    candidates.sort((a, b) => a - b);
    return Math.round(candidates[0] * 100) / 100;
  }

  private computeStopLoss(
    input: SignalEngineInput,
    direction: "long" | "short" | "neutral"
  ): number | undefined {
    const { atr, currentPrice, latestSwingHigh, latestSwingLow } = input;
    const buffer = (atr || currentPrice * 0.003) * ATR_BUFFER_MULT;

    if (direction === "long") {
      const base = latestSwingLow || (currentPrice - (atr || currentPrice * 0.01));
      return Math.round((base - buffer) * 100) / 100;
    }

    if (direction === "short") {
      const base = latestSwingHigh || (currentPrice + (atr || currentPrice * 0.01));
      return Math.round((base + buffer) * 100) / 100;
    }

    return undefined;
  }

  private computeTakeProfit(
    input: SignalEngineInput,
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number,
    stopLoss?: number
  ): number | undefined {
    const { pivotRelation, nearestResistance, nearestSupport } = input;

    if (direction === "long") {
      const candidates: number[] = [];
      if (nearestResistance) candidates.push(nearestResistance);
      if (pivotRelation.levels.r1 > (entryLong || 0)) {
        candidates.push(pivotRelation.levels.r1);
      }
      if (pivotRelation.levels.pivot > (entryLong || 0)) {
        candidates.push(pivotRelation.levels.pivot);
      }

      if (entryLong && stopLoss) {
        const risk = entryLong - stopLoss;
        const rrTarget = entryLong + risk * 1.5;
        candidates.push(rrTarget);
      }

      candidates.sort((a, b) => a - b);
      return candidates.length > 0
        ? Math.round(candidates[0] * 100) / 100
        : undefined;
    }

    if (direction === "short") {
      const candidates: number[] = [];
      if (nearestSupport) candidates.push(nearestSupport);
      if (pivotRelation.levels.s1 < (entryShort || Infinity)) {
        candidates.push(pivotRelation.levels.s1);
      }

      if (entryShort && stopLoss) {
        const risk = stopLoss - entryShort;
        const rrTarget = entryShort - risk * 1.5;
        candidates.push(rrTarget);
      }

      candidates.sort((a, b) => b - a);
      return candidates.length > 0
        ? Math.round(candidates[0] * 100) / 100
        : undefined;
    }

    return undefined;
  }

  private computeTarget(
    input: SignalEngineInput,
    direction: "long" | "short" | "neutral"
  ): number | undefined {
    const { pivotRelation } = input;
    return pivotRelation.targetHint;
  }

  private computeRR(
    direction: "long" | "short" | "neutral",
    entry?: number,
    sl?: number,
    tp?: number
  ): number | undefined {
    if (!entry || !sl || !tp) return undefined;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk === 0) return undefined;
    return Math.round((reward / risk) * 100) / 100;
  }

  private checkInvalidation(
    input: SignalEngineInput,
    state: SignalState,
    prev?: TradingSignal
  ): string | undefined {
    if (!prev) return undefined;

    if (
      prev.state === "watch_short" &&
      input.globalLongPercent > input.globalShortPercent + 10
    ) {
      return "Global bias flipped to bullish. Short setup invalidated.";
    }

    if (
      prev.state === "watch_long" &&
      input.globalShortPercent > input.globalLongPercent + 10
    ) {
      return "Global bias flipped to bearish. Long setup invalidated.";
    }

    if (prev.stopLoss !== undefined) {
      if (prev.direction === "long" && input.currentPrice < prev.stopLoss) {
        return "Price hit stop loss level.";
      }
      if (prev.direction === "short" && input.currentPrice > prev.stopLoss) {
        return "Price hit stop loss level.";
      }
    }

    return undefined;
  }

  private buildSummary(
    input: SignalEngineInput,
    state: SignalState,
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number,
    target?: number
  ): string {
    const { pivotRelation, currentPrice } = input;
    const pivotStr = pivotRelation.levels.pivot.toFixed(2);

    if (state === "idle") {
      return `Chưa có setup rõ ràng. Pivot: ${pivotStr}. Theo dõi thêm.`;
    }

    if (state === "invalidated") {
      return `Setup trước đã bị vô hiệu hóa. Chờ điều kiện mới.`;
    }

    const parts: string[] = [];
    parts.push(pivotRelation.narrative);

    if (state === "ready_short" || state === "watch_short") {
      if (entryShort) {
        parts.push(
          `Canh Short tại ${entryShort.toFixed(2)} nếu giá hồi lên vùng kháng cự và bị từ chối.`
        );
      }
    }

    if (state === "ready_long" || state === "watch_long") {
      if (entryLong) {
        parts.push(
          `Canh Long tại ${entryLong.toFixed(2)} nếu giá pullback về vùng hỗ trợ và giữ được.`
        );
      }
    }

    if (target) {
      parts.push(`Mục tiêu hướng về ${target.toFixed(2)}.`);
    }

    return parts.join(" ");
  }

  private buildDetails(
    input: SignalEngineInput,
    state: SignalState,
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number,
    stopLoss?: number,
    takeProfit?: number,
    target?: number
  ): string[] {
    const details: string[] = [];

    details.push(`State: ${state}`);
    details.push(`Direction: ${direction}`);
    details.push(
      `Global bias: Long ${input.globalLongPercent}% / Short ${input.globalShortPercent}%`
    );

    if (entryLong) details.push(`Entry Long: ${entryLong.toFixed(2)}`);
    if (entryShort) details.push(`Entry Short: ${entryShort.toFixed(2)}`);
    if (stopLoss) details.push(`Stop Loss: ${stopLoss.toFixed(2)}`);
    if (takeProfit) details.push(`Take Profit: ${takeProfit.toFixed(2)}`);
    if (target) details.push(`Target: ${target.toFixed(2)}`);

    details.push(`Pivot: ${input.pivotRelation.levels.pivot.toFixed(2)}`);
    details.push(`Pivot state: ${input.pivotRelation.state}`);
    details.push(`Trendlines: ${input.trendlineOutput.trendlineCount} active`);

    const bigFrames = input.timeframeScores.filter((s) =>
      ["4h", "1d", "1w"].includes(s.timeframe)
    );
    for (const f of bigFrames) {
      details.push(
        `${f.timeframe}: Long ${f.longScore} / Short ${f.shortScore} (${f.dominantBias})`
      );
    }

    return details;
  }
}
