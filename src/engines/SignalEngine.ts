import {
  SignalEngineInput,
  TradingSignal,
  SignalState,
  SignalStep,
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
        state: "cooldown",
        summaryText: "Đang trong thời gian cooldown. Chờ điều kiện mới.",
        updatedAt: currentTime,
      };
    }

    const state = this.resolveState(input, previousSignal);
    const invalidationReason = this.checkInvalidation(input, state, previousSignal);
    const finalState: SignalState = invalidationReason ? "invalidated" : state;
    const direction = this.resolveDirection(finalState);

    const entryLong = direction === "long" ? this.computeEntryLong(input) : undefined;
    const entryShort = direction === "short" ? this.computeEntryShort(input) : undefined;
    const stopLoss = this.computeStopLoss(input, direction, entryLong, entryShort);
    const takeProfit = this.computeTakeProfit(input, direction, entryLong, entryShort, stopLoss);
    const target = this.computeTarget(input, direction, entryLong, entryShort, takeProfit);

    const rr = this.computeRR(
      direction,
      direction === "long" ? entryLong : entryShort,
      stopLoss,
      takeProfit
    );

    const summaryText = this.buildSummary(input, finalState, direction, entryLong, entryShort, target);
    const detailText = this.buildDetails(input, finalState, direction, entryLong, entryShort, stopLoss, takeProfit, target);
    const steps = this.buildSteps(input, finalState, direction, entryLong, entryShort, stopLoss);
    const overallConfidence = this.computeOverallConfidence(input, finalState, direction);

    const cooldownUntil =
      finalState === "invalidated"
        ? currentTime + COOLDOWN_MS
        : previousSignal?.cooldownUntil;

    const { primaryScenario, alternativeScenario } = this.buildScenarios(input, finalState, direction);

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
      steps,
      overallConfidence,
      primaryScenario,
      alternativeScenario,
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
    const totalBigFrames = this.countBigFramesAvailable(timeframeScores);
    const bigFrameMinRequired = Math.max(1, Math.min(2, Math.floor(totalBigFrames * 0.4)));

    const pivotBlocksBearish = pivotRelation.state === "above_pivot" && pivotRelation.directionBias === "bullish";
    const pivotBlocksBullish = pivotRelation.state === "below_pivot" && pivotRelation.directionBias === "bearish";

    const canWatchShort =
      globalShortPercent >= WATCH_THRESHOLD &&
      bigFramesBearish >= bigFrameMinRequired &&
      !pivotBlocksBearish;

    const canWatchLong =
      globalLongPercent >= WATCH_THRESHOLD &&
      bigFramesBullish >= bigFrameMinRequired &&
      !pivotBlocksBullish;

    const activeSupports = trendlineOutput.activeTrendlines.filter(
      (t) => t.type.includes("support") && !t.isBroken
    );
    const activeResistances = trendlineOutput.activeTrendlines.filter(
      (t) => t.type.includes("resistance") && !t.isBroken
    );
    const brokenSupports = trendlineOutput.activeTrendlines.filter(
      (t) => t.type.includes("support") && t.isBroken
    );

    const hasResistanceNearby = activeResistances.some((t) => t.normalizedDistance <= 1.2);
    const hasSupportNearby = activeSupports.some((t) => t.normalizedDistance <= 1.2);
    const supportInTouchZone = activeSupports.some(
      (t) => t.proximity === "touch_zone" || t.proximity === "reaction_zone"
    );
    const resistanceInTouchZone = activeResistances.some(
      (t) => t.proximity === "touch_zone" || t.proximity === "reaction_zone"
    );
    const hasBrokenSupportBreakdown = brokenSupports.some((t) => t.normalizedDistance <= 2);

    const nearPrevShortEntry = prev?.entryShort
      ? Math.abs(currentPrice - prev.entryShort) / currentPrice < 0.002
      : false;
    const nearPrevLongEntry = prev?.entryLong
      ? Math.abs(currentPrice - prev.entryLong) / currentPrice < 0.002
      : false;

    const shortReady = resistanceInTouchZone || (hasBrokenSupportBreakdown && globalShortPercent >= 65);
    const longReady = supportInTouchZone;

    const shortTriggered =
      shortReady &&
      (
        resistanceInTouchZone ||
        nearPrevShortEntry ||
        (input.nearestResistance !== undefined && currentPrice >= input.nearestResistance)
      );
    const longTriggered =
      longReady &&
      (
        supportInTouchZone ||
        nearPrevLongEntry ||
        (input.nearestSupport !== undefined && currentPrice <= input.nearestSupport)
      );

    if (prev?.state === "active_short" && prev.entryShort) {
      return "active_short";
    }
    if (prev?.state === "active_long" && prev.entryLong) {
      return "active_long";
    }
    if (prev?.state === "triggered_short" && prev.entryShort && currentPrice < prev.entryShort) {
      return "active_short";
    }
    if (prev?.state === "triggered_long" && prev.entryLong && currentPrice > prev.entryLong) {
      return "active_long";
    }

    if (canWatchShort && globalShortPercent >= READY_THRESHOLD) {
      if (shortTriggered) return "triggered_short";
      if (shortReady) return "ready_short";
      if (hasResistanceNearby) return "watch_short";
      return "watch_short";
    }

    if (canWatchLong && globalLongPercent >= READY_THRESHOLD) {
      if (longTriggered) return "triggered_long";
      if (longReady) return "ready_long";
      if (hasSupportNearby) return "watch_long";
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

  private countBigFramesAvailable(scores: TimeframeScore[]): number {
    const bigFrames = ["4h", "6h", "8h", "12h", "1d", "1w"];
    return scores.filter((s) => bigFrames.includes(s.timeframe)).length;
  }

  private computeEntryLong(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestSupport, pivotRelation, atr, trendlineOutput } = input;
    const effectiveAtr = atr || currentPrice * 0.005;

    const primarySup = trendlineOutput.primarySupport;
    if (primarySup && !primarySup.isBroken && primarySup.projectedPriceNow > 0 && primarySup.projectedPriceNow < currentPrice) {
      return Math.round(primarySup.projectedPriceNow * 100) / 100;
    }

    const candidates: number[] = [];
    if (nearestSupport !== undefined && nearestSupport < currentPrice) candidates.push(nearestSupport);
    if (pivotRelation.state === "below_pivot" && pivotRelation.levels.s1 < currentPrice) {
      candidates.push(pivotRelation.levels.s1);
    }

    const nearTL = trendlineOutput.activeTrendlines.find(
      (t) => t.type.includes("support") && !t.isBroken && t.projectedPriceNow > 0 && t.projectedPriceNow < currentPrice && t.normalizedDistance < 2
    );
    if (nearTL) candidates.push(nearTL.projectedPriceNow);

    if (candidates.length === 0) return Math.round((currentPrice - effectiveAtr * 0.8) * 100) / 100;
    candidates.sort((a, b) => b - a);
    return Math.round(candidates[0] * 100) / 100;
  }

  private computeEntryShort(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestResistance, pivotRelation, atr, trendlineOutput } = input;
    const effectiveAtr = atr || currentPrice * 0.005;

    const primaryRes = trendlineOutput.primaryResistance;
    if (primaryRes && !primaryRes.isBroken && primaryRes.projectedPriceNow > 0 && primaryRes.projectedPriceNow > currentPrice) {
      return Math.round(primaryRes.projectedPriceNow * 100) / 100;
    }

    const candidates: number[] = [];
    if (nearestResistance !== undefined && nearestResistance > currentPrice) candidates.push(nearestResistance);
    if (pivotRelation.levels.r1 > currentPrice) candidates.push(pivotRelation.levels.r1);
    if ((pivotRelation.state === "above_pivot" || pivotRelation.state === "approaching_pivot_from_below") && pivotRelation.levels.pivot > currentPrice) {
      candidates.push(pivotRelation.levels.pivot);
    }

    const nearTL = trendlineOutput.activeTrendlines.find(
      (t) => t.type.includes("resistance") && !t.isBroken && t.projectedPriceNow > currentPrice && t.normalizedDistance < 2
    );
    if (nearTL) candidates.push(nearTL.projectedPriceNow);

    if (candidates.length === 0) return Math.round((currentPrice + effectiveAtr * 0.8) * 100) / 100;
    candidates.sort((a, b) => a - b);
    return Math.round(candidates[0] * 100) / 100;
  }

  private computeStopLoss(
    input: SignalEngineInput,
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number
  ): number | undefined {
    const { atr, currentPrice, latestSwingHigh, latestSwingLow } = input;
    const buffer = (atr || currentPrice * 0.003) * ATR_BUFFER_MULT;
    const atrFallback = atr || currentPrice * 0.01;

    if (direction === "long") {
      const entry = entryLong || currentPrice;
      const swingBase = latestSwingLow && latestSwingLow < entry ? latestSwingLow : undefined;
      const base = swingBase || (entry - atrFallback);
      let sl = Math.round((base - buffer) * 100) / 100;
      if (sl >= entry) {
        sl = Math.round((entry - atrFallback * 0.8) * 100) / 100;
      }
      return sl;
    }

    if (direction === "short") {
      const entry = entryShort || currentPrice;
      const swingBase = latestSwingHigh && latestSwingHigh > entry ? latestSwingHigh : undefined;
      const base = swingBase || (entry + atrFallback);
      let sl = Math.round((base + buffer) * 100) / 100;
      if (sl <= entry) {
        sl = Math.round((entry + atrFallback * 0.8) * 100) / 100;
      }
      return sl;
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
      if (entryLong && nearestResistance !== undefined && nearestResistance > entryLong) candidates.push(nearestResistance);
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
      if (entryShort && nearestSupport !== undefined && nearestSupport < entryShort) candidates.push(nearestSupport);
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
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number,
    takeProfit?: number
  ): number | undefined {
    const { pivotRelation, currentPrice, atr, nearestResistance, nearestSupport } = input;
    const entry = direction === "long" ? entryLong : entryShort;

    if (takeProfit && entry && Math.abs(takeProfit - entry) / (entry || 1) > 0.001) {
      return takeProfit;
    }

    if (direction === "long") {
      const candidates = [pivotRelation.targetHint, nearestResistance, pivotRelation.levels.r1]
        .filter((v): v is number => v !== undefined && v > (entry || currentPrice));
      if (candidates.length > 0) return Math.round(Math.min(...candidates) * 100) / 100;
      const atrTarget = (entry || currentPrice) + (atr || currentPrice * 0.01) * 1.5;
      return Math.round(atrTarget * 100) / 100;
    }

    if (direction === "short") {
      const candidates = [pivotRelation.targetHint, nearestSupport, pivotRelation.levels.s1]
        .filter((v): v is number => v !== undefined && v < (entry || currentPrice));
      if (candidates.length > 0) return Math.round(Math.max(...candidates) * 100) / 100;
      const atrTarget = (entry || currentPrice) - (atr || currentPrice * 0.01) * 1.5;
      return Math.round(atrTarget * 100) / 100;
    }

    return undefined;
  }

  private computeRR(
    direction: "long" | "short" | "neutral",
    entry?: number,
    sl?: number,
    tp?: number
  ): number | undefined {
    if (!entry || !sl || !tp) return undefined;
    if (direction === "long") {
      if (sl >= entry || tp <= entry) return undefined;
    } else if (direction === "short") {
      if (sl <= entry || tp >= entry) return undefined;
    } else {
      return undefined;
    }
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk === 0 || reward <= 0) return undefined;
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
      const { globalLongPercent, globalShortPercent } = input;
      if (Math.abs(globalLongPercent - globalShortPercent) < 10) {
        return `Thị trường đang cân bằng (Long ${globalLongPercent}% / Short ${globalShortPercent}%). Pivot: ${pivotStr}. Chờ tín hiệu rõ ràng hơn.`;
      }
      const leaning = globalLongPercent > globalShortPercent ? "Long" : "Short";
      const leanPct = Math.max(globalLongPercent, globalShortPercent);
      return `Đang nghiêng ${leaning} ${leanPct}% nhưng chưa đủ điều kiện vào lệnh. ${pivotRelation.narrative}`;
    }

    if (state === "invalidated") {
      return `Setup trước đã bị vô hiệu hóa. Chờ điều kiện mới.`;
    }

    const parts: string[] = [];
    parts.push(pivotRelation.narrative);

    if (state === "triggered_long" && entryLong) {
      parts.push(`Tín hiệu Long đã kích hoạt quanh ${entryLong.toFixed(2)}. Chờ xác nhận giữ giá để duy trì setup.`);
    } else if (state === "triggered_short" && entryShort) {
      parts.push(`Tín hiệu Short đã kích hoạt quanh ${entryShort.toFixed(2)}. Chờ xác nhận từ chối giá để duy trì setup.`);
    } else if (state === "active_long" && entryLong) {
      parts.push(`Lệnh Long đang hoạt động từ vùng ${entryLong.toFixed(2)}.`);
    } else if (state === "active_short" && entryShort) {
      parts.push(`Lệnh Short đang hoạt động từ vùng ${entryShort.toFixed(2)}.`);
    }

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

  private buildSteps(
    input: SignalEngineInput,
    state: SignalState,
    direction: "long" | "short" | "neutral",
    entryLong?: number,
    entryShort?: number,
    stopLoss?: number
  ): SignalStep[] {
    const { globalLongPercent, globalShortPercent, pivotRelation, currentPrice, nearestSupport, nearestResistance } = input;
    const isLong = direction === "long";
    const pct = isLong ? globalLongPercent : globalShortPercent;

    if (direction === "neutral") {
      return [
        { step: 1, title: "Xác nhận xu hướng đa khung", description: `Chờ bias rõ ràng hơn. Hiện tại: Long ${globalLongPercent}% / Short ${globalShortPercent}%`, status: "pending" },
        { step: 2, title: "Chờ xác nhận mô hình nến", description: "Theo dõi nến tiếp theo", status: "pending" },
        { step: 3, title: "Xác nhận vùng giá", description: "Chờ giá tiến vào vùng hợp lệ", status: "pending" },
        { step: 4, title: "Vào lệnh", description: "Chờ đủ điều kiện", status: "pending" },
      ];
    }

    const entry = isLong ? entryLong : entryShort;
    const entryPctFromPrice = entry ? this.formatEntryDistance(entry, currentPrice) : "?";
    const atrWidth = (input.atr || currentPrice * 0.005) * 0.5;
    let zoneLow = isLong ? (nearestSupport || pivotRelation.levels.s1) : (pivotRelation.levels.pivot);
    let zoneHigh = isLong ? (pivotRelation.levels.pivot) : (nearestResistance || pivotRelation.levels.r1);
    if (Math.abs(zoneHigh - zoneLow) < atrWidth) {
      const mid = (zoneHigh + zoneLow) / 2;
      zoneLow = mid - atrWidth / 2;
      zoneHigh = mid + atrWidth / 2;
    }
    const dirLabel = isLong ? "Long" : "Short";
    const zoneLabel = isLong ? "Hỗ trợ" : "Kháng cự";
    const slLabel = isLong ? "dưới Hỗ trợ" : "trên Kháng cự";
    const slAdj = stopLoss && entry ? (((Math.abs(stopLoss - entry) / entry) * 100).toFixed(1)) : "0.6";

    const directionalActive = state !== "idle" && state !== "invalidated" && state !== "cooldown";
    const candleConfirmedStates: SignalState[] = ["ready_long", "ready_short", "triggered_long", "triggered_short", "active_long", "active_short"];
    const zoneReachedStates: SignalState[] = ["triggered_long", "triggered_short", "active_long", "active_short"];
    const entryTriggeredStates: SignalState[] = ["triggered_long", "triggered_short"];
    const entryActiveStates: SignalState[] = ["active_long", "active_short"];

    const step1Status: SignalStep["status"] =
      directionalActive ? "completed" : (pct >= 55 ? "active" : "pending");
    const step2Status: SignalStep["status"] =
      candleConfirmedStates.includes(state) ? "completed" :
      (state === "watch_long" || state === "watch_short") ? "active" : "pending";
    const step3Status: SignalStep["status"] =
      zoneReachedStates.includes(state) ? "completed" :
      (state === "ready_long" || state === "ready_short") ? "active" : "pending";
    const step4Status: SignalStep["status"] =
      entryActiveStates.includes(state) ? "completed" :
      entryTriggeredStates.includes(state) ? "active" : "pending";

    const step3Title =
      step3Status === "completed"
        ? `Giá đã phản ứng tại vùng ${zoneLabel}`
        : step3Status === "active"
        ? `Giá đang trong vùng ${zoneLabel}`
        : `Chờ giá vào vùng ${zoneLabel}`;

    const step4Title =
      step4Status === "completed"
        ? `Đã vào lệnh ${dirLabel} với Stop Loss ${slLabel} (điều chỉnh +${slAdj}%)`
        : step4Status === "active"
        ? `Tín hiệu ${dirLabel} đã kích hoạt, chờ xác nhận tiếp diễn`
        : `Vào lệnh ${dirLabel} với Stop Loss ${slLabel} (đã điều chỉnh +${slAdj}%)`;

    const step4Description =
      step4Status === "completed"
        ? `Entry: ${entry?.toFixed(2) || "N/A"} | Giá hiện tại: ${currentPrice.toFixed(2)}`
        : step4Status === "active"
        ? `Entry: ${entry?.toFixed(2) || "N/A"} (${entryPctFromPrice}%)`
        : `Entry: ${entry?.toFixed(2) || "N/A"} (${entryPctFromPrice}%)`;

    return [
      {
        step: 1,
        title: `Xu hướng đa khung → ${dirLabel} ${pct}%`,
        description: `Đa số khung thời gian nghiêng ${dirLabel}`,
        status: step1Status,
      },
      {
        step: 2,
        title: step2Status === "completed"
          ? "Mô hình nến đã xác nhận tín hiệu"
          : "Đang chờ xác nhận mô hình nến",
        description: step2Status === "completed"
          ? `Nến đóng cửa xác nhận hướng ${dirLabel}`
          : "Theo dõi nến tiếp theo",
        status: step2Status,
      },
      {
        step: 3,
        title: step3Title,
        description: `zone: ${Math.min(zoneLow, zoneHigh).toFixed(2)} - ${Math.max(zoneLow, zoneHigh).toFixed(2)}`,
        status: step3Status,
      },
      {
        step: 4,
        title: step4Title,
        description: step4Description,
        status: step4Status,
      },
    ];
  }

  private computeOverallConfidence(
    input: SignalEngineInput,
    state: SignalState,
    direction: "long" | "short" | "neutral"
  ): number {
    if (state === "idle" || state === "invalidated" || direction === "neutral") return 30;

    const { globalLongPercent, globalShortPercent, timeframeScores, trendlineOutput } = input;
    const pct = direction === "long" ? globalLongPercent : globalShortPercent;

    let conf = pct;

    const aligned = timeframeScores.filter(s =>
      (direction === "long" && s.dominantBias === "bullish") ||
      (direction === "short" && s.dominantBias === "bearish")
    ).length;
    const tfBonus = Math.min(15, aligned * 3);
    conf += tfBonus;

    if (trendlineOutput.trendlineCount > 0) conf += 5;
    if (state === "ready_long" || state === "ready_short") conf += 8;

    return Math.min(99, Math.max(20, Math.round(conf)));
  }

  private buildScenarios(
    input: SignalEngineInput,
    state: SignalState,
    direction: "long" | "short" | "neutral"
  ): { primaryScenario?: string; alternativeScenario?: string } {
    const { pivotRelation, currentPrice } = input;
    const pivotPrice = pivotRelation.levels.pivot.toFixed(2);

    if (state === "idle" || state === "invalidated" || state === "cooldown") {
      return {
        primaryScenario: "Theo dõi thị trường, chờ tín hiệu rõ ràng hơn.",
        alternativeScenario: undefined,
      };
    }

    if (direction === "short") {
      return {
        primaryScenario: `Canh Short khi giá retest thất bại vùng kháng cự hoặc trendline giảm.`,
        alternativeScenario: `Nếu breakout và giữ trên Pivot ${pivotPrice}, chuyển sang kịch bản Long thận trọng.`,
      };
    }

    if (direction === "long") {
      return {
        primaryScenario: `Canh Long khi giá pullback về hỗ trợ và nến xác nhận giữ được đáy.`,
        alternativeScenario: `Nếu breakdown dưới hỗ trợ gần nhất, chuyển sang kịch bản Short.`,
      };
    }

    return {
      primaryScenario: "Thị trường đang sideway, chờ phá vỡ rõ ràng.",
      alternativeScenario: undefined,
    };
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

  private formatEntryDistance(entry: number, currentPrice: number): string {
    const raw = ((entry - currentPrice) / currentPrice) * 100;
    const normalized = Math.abs(raw) < 0.05 ? 0 : raw;
    return normalized.toFixed(1);
  }
}
