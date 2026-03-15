import {
  PivotEngineInput,
  PivotLevels,
  PivotRelation,
  PivotState,
} from "../types";

const PIVOT_PROXIMITY_PERCENT = 0.15;
const APPROACH_THRESHOLD_PERCENT = 0.5;

export class PivotEngine {
  computeLevels(high: number, low: number, close: number): PivotLevels {
    const pivot = (high + low + close) / 3;
    const range = high - low;
    return {
      pivot: this.round(pivot),
      r1: this.round(2 * pivot - low),
      s1: this.round(2 * pivot - high),
      r2: this.round(pivot + range),
      s2: this.round(pivot - range),
      r3: this.round(2 * pivot + (high - 2 * low)),
      s3: this.round(2 * pivot - (2 * high - low)),
    };
  }

  analyze(input: PivotEngineInput): PivotRelation {
    const levels = this.computeLevels(input.high, input.low, input.close);
    const { currentPrice, momentum } = input;

    const distToPivot = currentPrice - levels.pivot;
    const distAbs = Math.abs(distToPivot);
    const distPercent = (distAbs / levels.pivot) * 100;

    const state = this.determineState(
      currentPrice,
      levels,
      distPercent,
      momentum
    );

    const nearestRes = this.findNearestAbove(currentPrice, levels);
    const nearestSup = this.findNearestBelow(currentPrice, levels);
    const targetHint = this.computeTargetHint(
      currentPrice,
      levels,
      state,
      momentum
    );

    const directionBias = this.determineBias(state, currentPrice, levels);
    const narrative = this.buildNarrative(
      state,
      levels,
      currentPrice,
      targetHint,
      directionBias
    );

    return {
      levels,
      state,
      distanceToPivot: this.round(distToPivot),
      distanceToPivotPercent: this.round(distPercent),
      nearestResistance: nearestRes,
      nearestSupport: nearestSup,
      targetHint,
      directionBias,
      narrative,
    };
  }

  private determineState(
    price: number,
    levels: PivotLevels,
    distPercent: number,
    momentum?: "rising" | "falling" | "flat"
  ): PivotState {
    if (distPercent <= PIVOT_PROXIMITY_PERCENT) {
      return "at_pivot";
    }

    const isAbove = price > levels.pivot;
    const isApproaching =
      distPercent > PIVOT_PROXIMITY_PERCENT &&
      distPercent < APPROACH_THRESHOLD_PERCENT;

    if (isAbove) {
      if (isApproaching && momentum === "falling") {
        return "approaching_pivot_from_above";
      }
      if (momentum === "falling" && distPercent < 0.3) {
        return "rejected_from_pivot";
      }
      return "above_pivot";
    } else {
      if (isApproaching && momentum === "rising") {
        return "approaching_pivot_from_below";
      }
      if (momentum === "rising" && distPercent < APPROACH_THRESHOLD_PERCENT) {
        return "approaching_pivot_from_below";
      }
      return "below_pivot";
    }
  }

  private findNearestAbove(price: number, levels: PivotLevels): number {
    const allLevels = [
      levels.s3,
      levels.s2,
      levels.s1,
      levels.pivot,
      levels.r1,
      levels.r2,
      levels.r3,
    ].sort((a, b) => a - b);

    for (const lvl of allLevels) {
      if (lvl > price) return lvl;
    }
    return allLevels[allLevels.length - 1];
  }

  private findNearestBelow(price: number, levels: PivotLevels): number {
    const allLevels = [
      levels.s3,
      levels.s2,
      levels.s1,
      levels.pivot,
      levels.r1,
      levels.r2,
      levels.r3,
    ].sort((a, b) => b - a);

    for (const lvl of allLevels) {
      if (lvl < price) return lvl;
    }
    return allLevels[allLevels.length - 1];
  }

  private computeTargetHint(
    price: number,
    levels: PivotLevels,
    state: PivotState,
    momentum?: "rising" | "falling" | "flat"
  ): number {
    switch (state) {
      case "below_pivot":
      case "approaching_pivot_from_below":
        return levels.pivot;

      case "above_pivot":
        if (momentum === "rising") return levels.r1;
        return levels.pivot;

      case "approaching_pivot_from_above":
        return levels.pivot;

      case "at_pivot":
        if (momentum === "rising") return levels.r1;
        if (momentum === "falling") return levels.s1;
        return levels.pivot;

      case "rejected_from_pivot":
        return price > levels.pivot ? levels.r1 : levels.s1;

      default:
        return levels.pivot;
    }
  }

  private determineBias(
    state: PivotState,
    price: number,
    levels: PivotLevels
  ): "bullish" | "bearish" | "neutral" {
    switch (state) {
      case "above_pivot":
        return "bullish";
      case "below_pivot":
        return "bearish";
      case "approaching_pivot_from_below":
        return "neutral";
      case "approaching_pivot_from_above":
        return "neutral";
      case "at_pivot":
        return "neutral";
      case "rejected_from_pivot":
        return price > levels.pivot ? "bullish" : "bearish";
      default:
        return "neutral";
    }
  }

  private buildNarrative(
    state: PivotState,
    levels: PivotLevels,
    price: number,
    target: number,
    bias: "bullish" | "bearish" | "neutral"
  ): string {
    const pivotStr = levels.pivot.toFixed(2);
    const targetStr = target.toFixed(2);

    switch (state) {
      case "above_pivot":
        return `Giá đang ở phía trên Pivot (${pivotStr}), bias thiên bullish. Mục tiêu gần: ${targetStr}.`;

      case "below_pivot":
        return `Giá đang ở phía dưới Pivot (${pivotStr}), bias thiên bearish. Mục tiêu gần: ${targetStr}.`;

      case "approaching_pivot_from_below":
        return `Giá đang ở phía dưới Pivot (${pivotStr}), có xu hướng tiến về Pivot.`;

      case "approaching_pivot_from_above":
        return `Giá đang ở phía trên Pivot (${pivotStr}), có xu hướng hạ về Pivot.`;

      case "at_pivot":
        return `Giá đang sát Pivot (${pivotStr}), thị trường lưỡng lự. Theo dõi phản ứng tại vùng này.`;

      case "rejected_from_pivot":
        return `Giá vừa bị từ chối tại Pivot (${pivotStr}). Mục tiêu: ${targetStr}.`;

      default:
        return `Pivot hiện tại: ${pivotStr}.`;
    }
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
