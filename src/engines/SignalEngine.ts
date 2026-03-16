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
    const direction = this.resolveDirection(state);

    const entryLong = this.computeEntryLong(input);
    const entryShort = this.computeEntryShort(input);
    const stopLoss = this.computeStopLoss(input, direction, entryLong, entryShort);
    const takeProfit = this.computeTakeProfit(input, direction, entryLong, entryShort, stopLoss);
    const target = this.computeTarget(input, direction, entryLong, entryShort, takeProfit);

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
      structureState,
      emaContext,
      volumeContext,
    } = input;

    const bigFramesBearish = this.countBigFramesBias(timeframeScores, "bearish");
    const bigFramesBullish = this.countBigFramesBias(timeframeScores, "bullish");
    const totalBigFrames = this.countBigFramesAvailable(timeframeScores);
    const bigFrameMinRequired = Math.max(1, Math.min(2, Math.floor(totalBigFrames * 0.4)));

    const pivotBlocksBearish = pivotRelation.state === "above_pivot" && pivotRelation.directionBias === "bullish";
    const pivotBlocksBullish = pivotRelation.state === "below_pivot" && pivotRelation.directionBias === "bearish";

    const hasResistanceNearby = trendlineOutput.activeTrendlines.some(
      (t) => t.type.includes("resistance") && t.normalizedDistance <= 1.2
    );

    const hasSupportNearby = trendlineOutput.activeTrendlines.some(
      (t) => t.type.includes("support") && t.normalizedDistance <= 1.2
    );

    const supportInTouchZone = trendlineOutput.activeTrendlines.some(
      (t) => t.type.includes("support") && (t.proximity === "touch_zone" || t.proximity === "reaction_zone")
    );
    const resistanceInTouchZone = trendlineOutput.activeTrendlines.some(
      (t) => t.type.includes("resistance") && (t.proximity === "touch_zone" || t.proximity === "reaction_zone")
    );

    const hasBrokenSupportBelow = trendlineOutput.activeTrendlines.some(
      (t) => t.type.includes("support") && t.isBroken && t.normalizedDistance <= 2
    );

    const structureSupportsLong =
      structureState === "uptrend" ||
      structureState === "breakout" ||
      structureState === "retest_up";
    const structureSupportsShort =
      structureState === "downtrend" ||
      structureState === "breakdown" ||
      structureState === "retest_down";

    const emaSupportsLong =
      !emaContext ||
      emaContext.bullishAligned ||
      (emaContext.priceAboveEma20 && emaContext.ema20Slope > 0);
    const emaSupportsShort =
      !emaContext ||
      emaContext.bearishAligned ||
      (!emaContext.priceAboveEma20 && emaContext.ema20Slope < 0);

    const volumeSupportsLong =
      !volumeContext ||
      volumeContext.relativeVolume >= 0.85 ||
      volumeContext.bullVolumeRatio >= 0.52;
    const volumeSupportsShort =
      !volumeContext ||
      volumeContext.relativeVolume >= 0.85 ||
      volumeContext.bearVolumeRatio >= 0.52;

    const breakoutVolumeSupportsLong =
      !volumeContext ||
      (volumeContext.breakoutConfirmed && volumeContext.bullVolumeRatio >= volumeContext.bearVolumeRatio);
    const breakoutVolumeSupportsShort =
      !volumeContext ||
      (volumeContext.breakoutConfirmed && volumeContext.bearVolumeRatio >= volumeContext.bullVolumeRatio);

    const longContextReady = structureSupportsLong || hasSupportNearby || supportInTouchZone;
    const shortContextReady = structureSupportsShort || hasResistanceNearby || resistanceInTouchZone;

    const canWatchShort =
      globalShortPercent >= WATCH_THRESHOLD &&
      bigFramesBearish >= bigFrameMinRequired &&
      !pivotBlocksBearish &&
      shortContextReady &&
      emaSupportsShort &&
      volumeSupportsShort;

    const canWatchLong =
      globalLongPercent >= WATCH_THRESHOLD &&
      bigFramesBullish >= bigFrameMinRequired &&
      !pivotBlocksBullish &&
      longContextReady &&
      emaSupportsLong &&
      volumeSupportsLong;

    if (prev && canWatchShort && globalShortPercent >= READY_THRESHOLD) {
      if (prev.state === "ready_short" || prev.state === "triggered_short") {
        if (input.nearestResistance && currentPrice >= input.nearestResistance) {
          return "triggered_short";
        }
        if (hasResistanceNearby && prev.entryShort && Math.abs(currentPrice - prev.entryShort) / currentPrice < 0.002) {
          return "triggered_short";
        }
      }
      if (prev.state === "triggered_short" && prev.entryShort && currentPrice < prev.entryShort) {
        return "active_short";
      }
    }

    if (prev && canWatchLong && globalLongPercent >= READY_THRESHOLD) {
      if (prev.state === "ready_long" || prev.state === "triggered_long") {
        if (input.nearestSupport && currentPrice <= input.nearestSupport) {
          return "triggered_long";
        }
        if (hasSupportNearby && prev.entryLong && Math.abs(currentPrice - prev.entryLong) / currentPrice < 0.002) {
          return "triggered_long";
        }
      }
      if (prev.state === "triggered_long" && prev.entryLong && currentPrice > prev.entryLong) {
        return "active_long";
      }
    }

    if (canWatchShort && globalShortPercent >= READY_THRESHOLD) {
      if (resistanceInTouchZone) return "ready_short";
      if (hasBrokenSupportBelow && globalShortPercent >= 65 && breakoutVolumeSupportsShort) return "ready_short";
      if (hasResistanceNearby) return "watch_short";
      return "watch_short";
    }

    if (canWatchLong && globalLongPercent >= READY_THRESHOLD) {
      if (supportInTouchZone) return "ready_long";
      if (structureState === "breakout" && breakoutVolumeSupportsLong) return "ready_long";
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

  private rankEntryCandidate(
    price: number,
    currentPrice: number,
    atr: number,
    basePriority: number
  ): number {
    const atrDistance = Math.abs(currentPrice - price) / atr;
    return Math.round((basePriority - atrDistance * 8) * 100) / 100;
  }

  private pushLongCandidate(
    candidates: { price: number; score: number }[],
    price: number | undefined,
    currentPrice: number,
    atr: number,
    basePriority: number
  ): void {
    if (!price || price <= 0 || price >= currentPrice) return;
    candidates.push({
      price: Math.round(price * 100) / 100,
      score: this.rankEntryCandidate(price, currentPrice, atr, basePriority),
    });
  }

  private pushShortCandidate(
    candidates: { price: number; score: number }[],
    price: number | undefined,
    currentPrice: number,
    atr: number,
    basePriority: number
  ): void {
    if (!price || price <= 0 || price <= currentPrice) return;
    candidates.push({
      price: Math.round(price * 100) / 100,
      score: this.rankEntryCandidate(price, currentPrice, atr, basePriority),
    });
  }

  private selectBestEntry(
    candidates: { price: number; score: number }[],
    fallback: number
  ): number {
    if (candidates.length === 0) return Math.round(fallback * 100) / 100;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Math.abs(a.price - fallback) - Math.abs(b.price - fallback);
    });

    const deduped: { price: number; score: number }[] = [];
    for (const candidate of candidates) {
      const exists = deduped.some((item) => Math.abs(item.price - candidate.price) / candidate.price < 0.0015);
      if (!exists) deduped.push(candidate);
    }

    return Math.round(deduped[0].price * 100) / 100;
  }

  private computeEntryLong(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestSupport, pivotRelation, atr, trendlineOutput } = input;
    const effectiveAtr = atr || currentPrice * 0.005;
    const fallback = currentPrice - effectiveAtr * 0.65;
    const candidates: { price: number; score: number }[] = [];

    this.pushLongCandidate(candidates, nearestSupport, currentPrice, effectiveAtr, 100);
    this.pushLongCandidate(candidates, pivotRelation.levels.s1, currentPrice, effectiveAtr, 96);
    if (pivotRelation.levels.pivot < currentPrice) {
      this.pushLongCandidate(
        candidates,
        pivotRelation.levels.pivot,
        currentPrice,
        effectiveAtr,
        pivotRelation.state === "above_pivot" ? 104 : 88
      );
    }

    const primarySup = trendlineOutput.primarySupport;
    if (primarySup && !primarySup.isBroken && primarySup.normalizedDistance <= 2.4) {
      this.pushLongCandidate(candidates, primarySup.projectedPriceNow, currentPrice, effectiveAtr, 98);
    }

    for (const line of trendlineOutput.activeTrendlines) {
      if (!line.type.includes("support") || line.isBroken || line.normalizedDistance > 2.2) continue;
      const basePriority = line.tier === "primary" ? 95 : 86;
      this.pushLongCandidate(candidates, line.projectedPriceNow, currentPrice, effectiveAtr, basePriority);
    }

    return this.selectBestEntry(candidates, fallback);
  }

  private computeEntryShort(input: SignalEngineInput): number | undefined {
    const { currentPrice, nearestResistance, pivotRelation, atr, trendlineOutput } = input;
    const effectiveAtr = atr || currentPrice * 0.005;
    const fallback = currentPrice + effectiveAtr * 0.65;
    const candidates: { price: number; score: number }[] = [];

    this.pushShortCandidate(candidates, nearestResistance, currentPrice, effectiveAtr, 100);
    this.pushShortCandidate(candidates, pivotRelation.levels.r1, currentPrice, effectiveAtr, 96);
    if (pivotRelation.levels.pivot > currentPrice) {
      this.pushShortCandidate(
        candidates,
        pivotRelation.levels.pivot,
        currentPrice,
        effectiveAtr,
        pivotRelation.state === "below_pivot" ? 104 : 88
      );
    }

    const primaryRes = trendlineOutput.primaryResistance;
    if (primaryRes && !primaryRes.isBroken && primaryRes.normalizedDistance <= 2.4) {
      this.pushShortCandidate(candidates, primaryRes.projectedPriceNow, currentPrice, effectiveAtr, 98);
    }

    for (const line of trendlineOutput.activeTrendlines) {
      if (!line.type.includes("resistance") || line.isBroken || line.normalizedDistance > 2.2) continue;
      const basePriority = line.tier === "primary" ? 95 : 86;
      this.pushShortCandidate(candidates, line.projectedPriceNow, currentPrice, effectiveAtr, basePriority);
    }

    return this.selectBestEntry(candidates, fallback);
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

    const step1Status: SignalStep["status"] =
      (state !== "idle" && state !== "invalidated") ? "completed" : (pct >= 55 ? "active" : "pending");

    const step2Status: SignalStep["status"] =
      (state === "ready_long" || state === "ready_short") ? "completed" :
      (state === "watch_long" || state === "watch_short") ? "active" : "pending";

    const step3Status: SignalStep["status"] =
      (state === "ready_long" || state === "ready_short") ? "active" : "pending";

    const step4Status: SignalStep["status"] = "pending";

    if (direction === "neutral") {
      return [
        { step: 1, title: "Xác nhận xu hướng đa khung", description: `Chờ bias rõ ràng hơn. Hiện tại: Long ${globalLongPercent}% / Short ${globalShortPercent}%`, status: "pending" },
        { step: 2, title: "Chờ xác nhận mô hình nến", description: "Theo dõi nến tiếp theo", status: "pending" },
        { step: 3, title: "Xác nhận vùng giá", description: "Chờ giá tiến vào vùng hợp lệ", status: "pending" },
        { step: 4, title: "Vào lệnh", description: "Chờ đủ điều kiện", status: "pending" },
      ];
    }

    const entry = isLong ? entryLong : entryShort;
    const entryPctFromPrice = entry ? (((entry - currentPrice) / currentPrice) * 100).toFixed(1) : "?";
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
        title: step3Status === "active"
          ? `Giá đang trong vùng ${zoneLabel}`
          : `Chờ giá vào vùng ${zoneLabel}`,
        description: `zone: ${Math.min(zoneLow, zoneHigh).toFixed(2)} - ${Math.max(zoneLow, zoneHigh).toFixed(2)}`,
        status: step3Status,
      },
      {
        step: 4,
        title: `Vào lệnh ${dirLabel} với Stop Loss ${slLabel} (đã điều chỉnh +${slAdj}%)`,
        description: `Entry: ${entry?.toFixed(2) || "N/A"} (${entryPctFromPrice}%)`,
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

    const { globalLongPercent, globalShortPercent, timeframeScores, trendlineOutput, emaContext, volumeContext } = input;
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
    if (emaContext?.bullishAligned && direction === "long") conf += 5;
    if (emaContext?.bearishAligned && direction === "short") conf += 5;
    if (volumeContext?.relativeVolume && volumeContext.relativeVolume >= 1.2) conf += 4;

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
    details.push(`Structure: ${input.structureState}`);
    if (input.emaContext) {
      details.push(
        `EMA: 20 ${input.emaContext.ema20 ?? "N/A"} / 50 ${input.emaContext.ema50 ?? "N/A"} / 200 ${input.emaContext.ema200 ?? "N/A"}`
      );
    }
    if (input.volumeContext) {
      details.push(
        `Volume: RVOL ${input.volumeContext.relativeVolume.toFixed(2)} / bull ${Math.round(input.volumeContext.bullVolumeRatio * 100)}% / bear ${Math.round(input.volumeContext.bearVolumeRatio * 100)}%`
      );
    }

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
