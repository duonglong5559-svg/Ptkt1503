import {
  Candle, SwingPoint, Trendline, TrendlineEngineInput, TrendlineEngineOutput,
  TrendlineInteraction, TrendlineType, TrendlineProximity, TrendlineVisualState,
} from "../types";

const MAX_ACTIVE_LINES = 4;
const TOUCH_TOLERANCE_RATIO = 0.003;

let lineIdCounter = 0;

export class TrendlineEngine {
  analyze(input: TrendlineEngineInput): TrendlineEngineOutput {
    const { candles, swings, currentPrice, currentIndex, symbol, timeframe, atr } = input;
    const effectiveATR = atr || currentPrice * 0.008;

    if (swings.length < 2) return this.emptyOutput(symbol, timeframe);

    const swingLows = swings.filter((s) => s.type === "low").slice(-10);
    const swingHighs = swings.filter((s) => s.type === "high").slice(-10);

    const candidates: Trendline[] = [];
    this.buildLines(swingLows, candles, currentPrice, currentIndex, effectiveATR, "ascending_support", candidates);
    this.buildLines(swingHighs, candles, currentPrice, currentIndex, effectiveATR, "descending_resistance", candidates);

    this.countTouches(candidates, candles, currentIndex);
    this.computeProximity(candidates, currentPrice, currentIndex, effectiveATR);
    this.scoreTrendlines(candidates, currentPrice, currentIndex, effectiveATR);
    this.detectInteractions(candidates, candles, currentPrice, currentIndex, effectiveATR);

    candidates.sort((a, b) => b.strength - a.strength);
    const deduped = this.dedupeLines(candidates);

    const unbroken = deduped.filter((t) => !t.isBroken && t.strength >= 30);
    const recentlyBroken = deduped.filter((t) => t.isBroken && t.strength >= 25 && t.distanceToPricePercent < 3);

    const activeTrendlines = [...unbroken.slice(0, MAX_ACTIVE_LINES)];
    const remainingSlots = MAX_ACTIVE_LINES - activeTrendlines.length;
    if (remainingSlots > 0) {
      activeTrendlines.push(...recentlyBroken.slice(0, remainingSlots));
    }

    this.assignTiers(activeTrendlines);
    this.assignVisualStates(activeTrendlines);

    const nearbyTrendlines = deduped
      .filter((t) => t.distanceToPricePercent < 2.0 && !activeTrendlines.includes(t) && t.strength >= 20)
      .slice(0, 2);

    const primarySupport = activeTrendlines.find((t) => t.type.includes("support") && t.tier === "primary");
    const primaryResistance = activeTrendlines.find((t) => t.type.includes("resistance") && t.tier === "primary");

    return {
      symbol, timeframe, activeTrendlines, nearbyTrendlines,
      trendlineCount: activeTrendlines.length,
      trendlineBias: this.computeBias(activeTrendlines, currentPrice),
      primarySupport, primaryResistance,
      summary: this.buildSummary(activeTrendlines, primarySupport, primaryResistance),
      updatedAt: Date.now(),
    };
  }

  private buildLines(
    points: SwingPoint[], candles: Candle[], currentPrice: number,
    currentIndex: number, atr: number, type: TrendlineType, out: Trendline[]
  ): void {
    const isAsc = type === "ascending_support";

    for (let i = 0; i < points.length - 1; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const p1 = points[i], p2 = points[j];
        if (isAsc && p2.price <= p1.price) continue;
        if (!isAsc && p2.price >= p1.price) continue;

        const dx = p2.index - p1.index;
        if (dx < 5) continue;

        const slope = (p2.price - p1.price) / dx;
        if (isAsc && slope <= 0) continue;
        if (!isAsc && slope >= 0) continue;

        const maxSlope = atr * 0.15;
        if (Math.abs(slope) > maxSlope) continue;

        const intercept = p1.price - slope * p1.index;
        const projectedPrice = slope * currentIndex + intercept;
        const dist = currentPrice - projectedPrice;
        const distPercent = (Math.abs(dist) / currentPrice) * 100;
        if (distPercent > 4) continue;

        const violations = this.countViolations(candles, slope, intercept, p1.index, p2.index, type);
        if (violations > 2) continue;

        out.push({
          id: `${isAsc ? "asc" : "desc"}_${++lineIdCounter}`,
          type,
          points: { x1: p1.index, y1: p1.price, x2: p2.index, y2: p2.price },
          slope, intercept,
          touches: 2, strength: 50,
          isBroken: false, lastInteraction: "none",
          distanceToPrice: Math.round(dist * 100) / 100,
          distanceToPricePercent: Math.round(distPercent * 100) / 100,
          projectedPriceNow: Math.round(projectedPrice * 100) / 100,
          normalizedDistance: 0, proximity: "far", visualState: "dim", tier: "secondary",
          createdAt: Date.now(),
        });
      }
    }
  }

  private countViolations(candles: Candle[], slope: number, intercept: number, start: number, end: number, type: TrendlineType): number {
    let v = 0;
    for (let i = start; i <= Math.min(end, candles.length - 1); i++) {
      const proj = slope * i + intercept;
      const tol = proj * TOUCH_TOLERANCE_RATIO;
      const isSup = type.includes("support");
      if (isSup && candles[i].close < proj - tol) v++;
      if (!isSup && candles[i].close > proj + tol) v++;
    }
    return v;
  }

  private countTouches(lines: Trendline[], candles: Candle[], currentIndex: number): void {
    for (const line of lines) {
      let touches = 0;
      const end = Math.min(currentIndex, candles.length - 1);
      for (let i = line.points.x1; i <= end; i++) {
        const proj = line.slope * i + line.intercept;
        const tol = Math.abs(proj) * TOUCH_TOLERANCE_RATIO;
        const isSup = line.type.includes("support");
        if (isSup && Math.abs(candles[i].low - proj) <= tol) touches++;
        if (!isSup && Math.abs(candles[i].high - proj) <= tol) touches++;
      }
      line.touches = Math.max(2, touches);
    }
  }

  private computeProximity(lines: Trendline[], currentPrice: number, currentIndex: number, atr: number): void {
    for (const line of lines) {
      const proj = line.slope * currentIndex + line.intercept;
      const dist = Math.abs(currentPrice - proj);
      const nd = dist / atr;

      line.projectedPriceNow = Math.round(proj * 100) / 100;
      line.normalizedDistance = Math.round(nd * 100) / 100;
      line.distanceToPrice = Math.round((currentPrice - proj) * 100) / 100;
      line.distanceToPricePercent = Math.round((dist / currentPrice) * 100 * 100) / 100;

      if (nd <= 0.15) line.proximity = "reaction_zone";
      else if (nd <= 0.25) line.proximity = "touch_zone";
      else if (nd <= 0.6) line.proximity = "approaching";
      else if (nd <= 1.2) line.proximity = "near";
      else line.proximity = "far";
    }
  }

  private scoreTrendlines(lines: Trendline[], currentPrice: number, currentIndex: number, atr: number): void {
    for (const line of lines) {
      let score = 25;
      score += Math.min(25, (line.touches - 2) * 8);

      if (line.normalizedDistance <= 0.25) score += 20;
      else if (line.normalizedDistance <= 0.6) score += 14;
      else if (line.normalizedDistance <= 1.2) score += 8;

      const span = Math.abs(line.points.x2 - line.points.x1);
      if (span > 40) score += 12;
      else if (span > 20) score += 8;
      else if (span > 10) score += 4;

      line.strength = Math.min(100, score);
    }
  }

  private detectInteractions(lines: Trendline[], candles: Candle[], currentPrice: number, currentIndex: number, atr: number): void {
    for (const line of lines) {
      const proj = line.projectedPriceNow;
      const dist = currentPrice - proj;
      const nd = line.normalizedDistance;
      const isSup = line.type.includes("support");

      if (isSup) {
        if (dist < -(atr * 0.2)) { line.isBroken = true; line.lastInteraction = "break"; }
        else if (nd <= 0.15) {
          line.lastInteraction = "touch";
          if (currentIndex > 1 && candles[currentIndex - 1]?.isClosed && candles[currentIndex - 1]?.close > proj)
            line.lastInteraction = "bounce";
        }
        else if (nd <= 0.6) line.lastInteraction = "approaching";
      } else {
        if (dist > atr * 0.2) { line.isBroken = true; line.lastInteraction = "break"; }
        else if (nd <= 0.15) {
          line.lastInteraction = "touch";
          if (currentIndex > 1 && candles[currentIndex - 1]?.isClosed && candles[currentIndex - 1]?.close < proj)
            line.lastInteraction = "bounce";
        }
        else if (nd <= 0.6) line.lastInteraction = "approaching";
      }
    }
  }

  private assignTiers(lines: Trendline[]): void {
    let supPrimary = false, resPrimary = false;
    for (const line of lines) {
      const isSup = line.type.includes("support");
      if (isSup && !supPrimary) { line.tier = "primary"; supPrimary = true; }
      else if (!isSup && !resPrimary) { line.tier = "primary"; resPrimary = true; }
      else line.tier = "secondary";
    }
  }

  private assignVisualStates(lines: Trendline[]): void {
    for (const line of lines) {
      if (line.isBroken) {
        line.visualState = line.lastInteraction === "retest" ? "retest" : "break";
      } else if (line.proximity === "reaction_zone" || line.proximity === "touch_zone") {
        line.visualState = "hot";
      } else if (line.proximity === "approaching") {
        line.visualState = "near";
      } else {
        line.visualState = "dim";
      }
    }
  }

  private dedupeLines(lines: Trendline[]): Trendline[] {
    const result: Trendline[] = [];
    for (const line of lines) {
      const isDup = result.some((e) =>
        e.type === line.type &&
        Math.abs(e.slope - line.slope) / (Math.abs(e.slope) || 0.0001) < 0.3 &&
        Math.abs(e.intercept - line.intercept) / (e.intercept || 1) < 0.003
      );
      if (!isDup) result.push(line);
    }
    return result;
  }

  private computeBias(lines: Trendline[], currentPrice: number): "bullish" | "bearish" | "neutral" {
    let bull = 0, bear = 0;
    for (const l of lines) {
      const isSup = l.type.includes("support");
      if (isSup && !l.isBroken) bull += l.strength;
      else if (!isSup && !l.isBroken) bear += l.strength;
      if (isSup && l.isBroken) bear += l.strength * 0.7;
      else if (!isSup && l.isBroken) bull += l.strength * 0.7;
    }
    if (Math.abs(bull - bear) < 15) return "neutral";
    return bull > bear ? "bullish" : "bearish";
  }

  private buildSummary(active: Trendline[], pSup?: Trendline, pRes?: Trendline): string {
    const parts: string[] = [];
    if (pSup) {
      const label = pSup.proximity === "reaction_zone" || pSup.proximity === "touch_zone"
        ? `đang kiểm tra` : pSup.proximity === "approaching" ? `đang tiến gần` : `đang hoạt động`;
      parts.push(`Hỗ trợ chính ~${pSup.projectedPriceNow.toFixed(2)} ${label}`);
    }
    if (pRes) {
      const label = pRes.proximity === "reaction_zone" || pRes.proximity === "touch_zone"
        ? `đang kiểm tra` : pRes.proximity === "approaching" ? `đang tiến gần` : `đang hoạt động`;
      parts.push(`Kháng cự chính ~${pRes.projectedPriceNow.toFixed(2)} ${label}`);
    }
    if (parts.length === 0) return "Chưa phát hiện đường xu hướng đáng chú ý.";
    return parts.join(". ") + ".";
  }

  private emptyOutput(symbol: string, timeframe: string): TrendlineEngineOutput {
    return {
      symbol, timeframe, activeTrendlines: [], nearbyTrendlines: [],
      trendlineCount: 0, trendlineBias: "neutral", summary: "Chưa đủ dữ liệu.",
      updatedAt: Date.now(),
    };
  }
}
