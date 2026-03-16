import {
  Candle, SwingPoint, Trendline, TrendlineEngineInput, TrendlineEngineOutput,
  TrendlineInteraction, TrendlineType, TrendlineProximity, TrendlineVisualState,
} from "../types";

const MAX_ACTIVE_LINES = 4;
const TOUCH_TOLERANCE_RATIO = 0.002;
const TOUCH_TOLERANCE_ATR_MULT = 0.12;
const BREAK_BUFFER_ATR_MULT = 0.2;
const MAX_ANCHOR_SKIP = 3;
const MIN_ANCHOR_STRENGTH = 50;

let lineIdCounter = 0;

export class TrendlineEngine {
  analyze(input: TrendlineEngineInput): TrendlineEngineOutput {
    const { candles, swings, currentPrice, currentIndex, symbol, timeframe, atr } = input;
    const effectiveATR = atr || currentPrice * 0.008;

    if (swings.length < 2) return this.emptyOutput(symbol, timeframe);

    const rawSwingLows = swings.filter((s) => s.type === "low").slice(-10);
    const rawSwingHighs = swings.filter((s) => s.type === "high").slice(-10);
    const swingLows = rawSwingLows.some((s) => s.strength >= MIN_ANCHOR_STRENGTH)
      ? rawSwingLows.filter((s) => s.strength >= MIN_ANCHOR_STRENGTH)
      : rawSwingLows;
    const swingHighs = rawSwingHighs.some((s) => s.strength >= MIN_ANCHOR_STRENGTH)
      ? rawSwingHighs.filter((s) => s.strength >= MIN_ANCHOR_STRENGTH)
      : rawSwingHighs;

    const candidates: Trendline[] = [];
    this.buildLines(swingLows, candles, currentPrice, currentIndex, effectiveATR, "ascending_support", candidates);
    this.buildLines(swingHighs, candles, currentPrice, currentIndex, effectiveATR, "descending_resistance", candidates);

    this.countTouches(candidates, swings, currentIndex, effectiveATR);
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
        if (j - i > MAX_ANCHOR_SKIP) continue;
        if (isAsc && p2.price <= p1.price) continue;
        if (!isAsc && p2.price >= p1.price) continue;
        if ((p1.strength + p2.strength) / 2 < MIN_ANCHOR_STRENGTH) continue;

        const dx = p2.index - p1.index;
        if (dx < 5) continue;

        const slope = (p2.price - p1.price) / dx;
        if (isAsc && slope <= 0) continue;
        if (!isAsc && slope >= 0) continue;

        const maxSlope = atr * 0.5;
        if (Math.abs(slope) > maxSlope) continue;

        const intercept = p1.price - slope * p1.index;
        const projectedPrice = slope * currentIndex + intercept;
        const dist = currentPrice - projectedPrice;
        const distPercent = (Math.abs(dist) / currentPrice) * 100;
        const normalizedDistance = Math.abs(dist) / (atr || 1);
        if (distPercent > 8 && normalizedDistance > 4.5) continue;

        if (this.hasIntermediateSwingViolation(points, slope, intercept, p1.index, p2.index, type, atr)) continue;

        const violations = this.countViolations(candles, slope, intercept, p1.index, p2.index, type, atr);
        if (violations > 1) continue;

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

  private hasIntermediateSwingViolation(
    points: SwingPoint[],
    slope: number,
    intercept: number,
    start: number,
    end: number,
    type: TrendlineType,
    atr: number
  ): boolean {
    const isSup = type.includes("support");
    for (const point of points) {
      if (point.index <= start || point.index >= end) continue;
      const projected = slope * point.index + intercept;
      const tolerance = this.getPriceTolerance(projected, atr);
      if (isSup && point.price < projected - tolerance) return true;
      if (!isSup && point.price > projected + tolerance) return true;
    }
    return false;
  }

  private countViolations(
    candles: Candle[],
    slope: number,
    intercept: number,
    start: number,
    end: number,
    type: TrendlineType,
    atr: number
  ): number {
    let v = 0;
    for (let i = start; i <= Math.min(end, candles.length - 1); i++) {
      if (i === start || i === end) continue;
      const proj = slope * i + intercept;
      const tol = this.getPriceTolerance(proj, atr);
      const isSup = type.includes("support");
      if (isSup && candles[i].low < proj - tol) v++;
      if (!isSup && candles[i].high > proj + tol) v++;
    }
    return v;
  }

  private countTouches(lines: Trendline[], swings: SwingPoint[], currentIndex: number, atr: number): void {
    for (const line of lines) {
      const matchingSwings = swings.filter(
        (s) =>
          s.type === (line.type.includes("support") ? "low" : "high") &&
          s.index >= line.points.x1 &&
          s.index <= currentIndex
      );
      let touches = 0;
      for (const swing of matchingSwings) {
        const proj = line.slope * swing.index + line.intercept;
        const tol = this.getPriceTolerance(proj, atr);
        if (Math.abs(swing.price - proj) <= tol) touches++;
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
      let score = 18;
      score += Math.min(30, Math.max(0, line.touches - 2) * 10);

      if (line.normalizedDistance <= 0.25) score += 20;
      else if (line.normalizedDistance <= 0.6) score += 14;
      else if (line.normalizedDistance <= 1.2) score += 8;

      const span = Math.abs(line.points.x2 - line.points.x1);
      if (span > 40) score += 12;
      else if (span > 20) score += 8;
      else if (span > 10) score += 4;

      const recency = Math.max(0, currentIndex - line.points.x2);
      if (recency <= 6) score += 8;
      else if (recency <= 12) score += 5;
      else if (recency <= 20) score += 2;

      line.strength = Math.min(100, score);
    }
  }

  private detectInteractions(lines: Trendline[], candles: Candle[], currentPrice: number, currentIndex: number, atr: number): void {
    for (const line of lines) {
      const proj = line.projectedPriceNow;
      const dist = currentPrice - proj;
      const nd = line.normalizedDistance;
      const isSup = line.type.includes("support");
      const activeIdx = Math.min(currentIndex, candles.length - 1);
      const lastClosed = candles[activeIdx];
      const touchBuffer = this.getPriceTolerance(proj, atr);
      const breakBuffer = Math.max(atr * BREAK_BUFFER_ATR_MULT, touchBuffer);

      if (isSup) {
        const confirmedBreak = !!lastClosed && lastClosed.close < proj - breakBuffer;
        if (confirmedBreak) {
          line.isBroken = true;
          line.lastInteraction = "break";
        } else if (!!lastClosed && lastClosed.low <= proj + touchBuffer && lastClosed.close > proj) {
          line.lastInteraction = "bounce";
        } else if (Math.abs(dist) <= touchBuffer || (!!lastClosed && lastClosed.low <= proj + touchBuffer)) {
          line.lastInteraction = "touch";
        } else if (nd <= 0.6) {
          line.lastInteraction = "approaching";
        }
      } else {
        const confirmedBreak = !!lastClosed && lastClosed.close > proj + breakBuffer;
        if (confirmedBreak) {
          line.isBroken = true;
          line.lastInteraction = "break";
        } else if (!!lastClosed && lastClosed.high >= proj - touchBuffer && lastClosed.close < proj) {
          line.lastInteraction = "bounce";
        } else if (Math.abs(dist) <= touchBuffer || (!!lastClosed && lastClosed.high >= proj - touchBuffer)) {
          line.lastInteraction = "touch";
        } else if (nd <= 0.6) {
          line.lastInteraction = "approaching";
        }
      }
    }
  }

  private getPriceTolerance(price: number, atr: number): number {
    return Math.max(Math.abs(price) * TOUCH_TOLERANCE_RATIO, atr * TOUCH_TOLERANCE_ATR_MULT);
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
