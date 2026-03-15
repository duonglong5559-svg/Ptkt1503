import {
  Candle,
  SwingPoint,
  Trendline,
  TrendlineEngineInput,
  TrendlineEngineOutput,
  TrendlineInteraction,
  TrendlineType,
} from "../types";

const MAX_ACTIVE_LINES = 5;
const TOUCH_TOLERANCE_RATIO = 0.003;
const APPROACH_DISTANCE_RATIO = 0.008;
const BREAK_CONFIRM_RATIO = 0.002;

let lineIdCounter = 0;

export class TrendlineEngine {
  analyze(input: TrendlineEngineInput): TrendlineEngineOutput {
    const { candles, swings, currentPrice, currentIndex, symbol, timeframe } =
      input;

    if (swings.length < 2) {
      return this.emptyOutput(symbol, timeframe);
    }

    const candidates: Trendline[] = [];

    const swingLows = swings.filter((s) => s.type === "low");
    const swingHighs = swings.filter((s) => s.type === "high");

    this.buildAscendingLines(swingLows, candles, currentPrice, currentIndex, candidates);
    this.buildDescendingLines(swingHighs, candles, currentPrice, currentIndex, candidates);

    this.countTouches(candidates, candles, currentIndex);
    this.scoreTrendlines(candidates, currentPrice, currentIndex);
    this.detectInteractions(candidates, candles, currentPrice, currentIndex);

    candidates.sort((a, b) => b.strength - a.strength);

    const activeTrendlines = candidates
      .filter((t) => !t.isBroken && t.strength >= 30)
      .slice(0, MAX_ACTIVE_LINES);

    const nearbyTrendlines = candidates
      .filter(
        (t) =>
          t.distanceToPricePercent < 2.0 &&
          !activeTrendlines.includes(t) &&
          t.strength >= 20
      )
      .slice(0, 3);

    const trendlineBias = this.computeBias(activeTrendlines, currentPrice);
    const summary = this.buildSummary(
      activeTrendlines,
      nearbyTrendlines,
      trendlineBias
    );

    return {
      symbol,
      timeframe,
      activeTrendlines,
      nearbyTrendlines,
      trendlineCount: activeTrendlines.length,
      trendlineBias,
      summary,
      updatedAt: Date.now(),
    };
  }

  private buildAscendingLines(
    lows: SwingPoint[],
    candles: Candle[],
    currentPrice: number,
    currentIndex: number,
    out: Trendline[]
  ): void {
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        if (lows[j].price <= lows[i].price) continue;

        const p1 = lows[i];
        const p2 = lows[j];
        const dx = p2.index - p1.index;
        if (dx === 0) continue;

        const slope = (p2.price - p1.price) / dx;
        if (slope <= 0) continue;

        const maxSlope = (currentPrice * 0.01) / 10;
        if (slope > maxSlope) continue;

        const intercept = p1.price - slope * p1.index;
        const projectedPrice = slope * currentIndex + intercept;
        const dist = currentPrice - projectedPrice;
        const distPercent = (Math.abs(dist) / currentPrice) * 100;

        if (distPercent > 5) continue;

        out.push({
          id: `asc_${++lineIdCounter}`,
          type: "ascending_support",
          points: {
            x1: p1.index,
            y1: p1.price,
            x2: p2.index,
            y2: p2.price,
          },
          slope,
          intercept,
          touches: 2,
          strength: 50,
          isBroken: false,
          lastInteraction: "none",
          distanceToPrice: Math.round(dist * 100) / 100,
          distanceToPricePercent: Math.round(distPercent * 100) / 100,
          createdAt: Date.now(),
        });
      }
    }
  }

  private buildDescendingLines(
    highs: SwingPoint[],
    candles: Candle[],
    currentPrice: number,
    currentIndex: number,
    out: Trendline[]
  ): void {
    for (let i = 0; i < highs.length - 1; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        if (highs[j].price >= highs[i].price) continue;

        const p1 = highs[i];
        const p2 = highs[j];
        const dx = p2.index - p1.index;
        if (dx === 0) continue;

        const slope = (p2.price - p1.price) / dx;
        if (slope >= 0) continue;

        const maxSlope = (currentPrice * 0.01) / 10;
        if (Math.abs(slope) > maxSlope) continue;

        const intercept = p1.price - slope * p1.index;
        const projectedPrice = slope * currentIndex + intercept;
        const dist = projectedPrice - currentPrice;
        const distPercent = (Math.abs(dist) / currentPrice) * 100;

        if (distPercent > 5) continue;

        out.push({
          id: `desc_${++lineIdCounter}`,
          type: "descending_resistance",
          points: {
            x1: p1.index,
            y1: p1.price,
            x2: p2.index,
            y2: p2.price,
          },
          slope,
          intercept,
          touches: 2,
          strength: 50,
          isBroken: false,
          lastInteraction: "none",
          distanceToPrice: Math.round(dist * 100) / 100,
          distanceToPricePercent: Math.round(distPercent * 100) / 100,
          createdAt: Date.now(),
        });
      }
    }
  }

  private countTouches(
    trendlines: Trendline[],
    candles: Candle[],
    currentIndex: number
  ): void {
    for (const line of trendlines) {
      let touches = 0;
      const startIdx = Math.min(line.points.x1, line.points.x2);
      const endIdx = Math.min(currentIndex, candles.length - 1);

      for (let i = startIdx; i <= endIdx; i++) {
        const projected = line.slope * i + line.intercept;
        const tol = Math.abs(projected) * TOUCH_TOLERANCE_RATIO;

        if (line.type === "ascending_support") {
          if (Math.abs(candles[i].low - projected) <= tol) touches++;
        } else {
          if (Math.abs(candles[i].high - projected) <= tol) touches++;
        }
      }

      line.touches = Math.max(2, touches);
    }
  }

  private scoreTrendlines(
    trendlines: Trendline[],
    currentPrice: number,
    currentIndex: number
  ): void {
    for (const line of trendlines) {
      let score = 30;

      score += Math.min(30, (line.touches - 2) * 10);

      if (line.distanceToPricePercent < 0.5) score += 15;
      else if (line.distanceToPricePercent < 1.0) score += 10;
      else if (line.distanceToPricePercent < 2.0) score += 5;

      const span = Math.abs(line.points.x2 - line.points.x1);
      if (span > 30) score += 10;
      else if (span > 15) score += 5;

      line.strength = Math.min(100, score);
    }
  }

  private detectInteractions(
    trendlines: Trendline[],
    candles: Candle[],
    currentPrice: number,
    currentIndex: number
  ): void {
    for (const line of trendlines) {
      const projected = line.slope * currentIndex + line.intercept;
      const tol = Math.abs(projected) * TOUCH_TOLERANCE_RATIO;
      const approachDist = Math.abs(projected) * APPROACH_DISTANCE_RATIO;
      const breakDist = Math.abs(projected) * BREAK_CONFIRM_RATIO;
      const dist = currentPrice - projected;
      const absDist = Math.abs(dist);

      line.distanceToPrice = Math.round(dist * 100) / 100;
      line.distanceToPricePercent =
        Math.round((absDist / currentPrice) * 100 * 100) / 100;

      if (line.type === "ascending_support") {
        if (dist < -breakDist) {
          line.isBroken = true;
          line.lastInteraction = this.detectRetest(
            line,
            candles,
            currentIndex,
            "ascending_support"
          );
          if (line.lastInteraction !== "retest") {
            line.lastInteraction = "break";
          }
        } else if (absDist <= tol) {
          line.lastInteraction = "touch";
          if (currentIndex > 1 && candles[currentIndex - 1]?.close > projected) {
            line.lastInteraction = "bounce";
          }
        } else if (dist > 0 && dist <= approachDist) {
          line.lastInteraction = "approaching";
        }
      } else {
        if (dist > breakDist) {
          line.isBroken = true;
          line.lastInteraction = this.detectRetest(
            line,
            candles,
            currentIndex,
            "descending_resistance"
          );
          if (line.lastInteraction !== "retest") {
            line.lastInteraction = "break";
          }
        } else if (absDist <= tol) {
          line.lastInteraction = "touch";
          if (
            currentIndex > 1 &&
            candles[currentIndex - 1]?.close < projected
          ) {
            line.lastInteraction = "bounce";
          }
        } else if (dist < 0 && absDist <= approachDist) {
          line.lastInteraction = "approaching";
        }
      }
    }
  }

  private detectRetest(
    line: Trendline,
    candles: Candle[],
    currentIndex: number,
    type: TrendlineType
  ): TrendlineInteraction {
    const lookback = Math.min(5, currentIndex);
    for (let i = currentIndex - 1; i >= currentIndex - lookback; i--) {
      if (i < 0) break;
      const projected = line.slope * i + line.intercept;
      const tol = Math.abs(projected) * TOUCH_TOLERANCE_RATIO * 2;

      if (type === "ascending_support") {
        if (
          Math.abs(candles[i].high - projected) <= tol &&
          candles[i].close < projected
        ) {
          return "retest";
        }
      } else {
        if (
          Math.abs(candles[i].low - projected) <= tol &&
          candles[i].close > projected
        ) {
          return "retest";
        }
      }
    }
    return "break";
  }

  private computeBias(
    trendlines: Trendline[],
    currentPrice: number
  ): "bullish" | "bearish" | "neutral" {
    let bullPoints = 0;
    let bearPoints = 0;

    for (const line of trendlines) {
      if (line.type === "ascending_support" && !line.isBroken) {
        bullPoints += line.strength;
      }
      if (line.type === "descending_resistance" && !line.isBroken) {
        bearPoints += line.strength;
      }
      if (
        line.type === "ascending_support" &&
        line.isBroken &&
        line.lastInteraction === "retest"
      ) {
        bearPoints += line.strength * 0.7;
      }
      if (
        line.type === "descending_resistance" &&
        line.isBroken &&
        line.lastInteraction === "retest"
      ) {
        bullPoints += line.strength * 0.7;
      }
    }

    const diff = bullPoints - bearPoints;
    if (Math.abs(diff) < 15) return "neutral";
    return diff > 0 ? "bullish" : "bearish";
  }

  private buildSummary(
    active: Trendline[],
    nearby: Trendline[],
    bias: "bullish" | "bearish" | "neutral"
  ): string {
    const parts: string[] = [];
    const ascCount = active.filter(
      (t) => t.type === "ascending_support"
    ).length;
    const descCount = active.filter(
      (t) => t.type === "descending_resistance"
    ).length;

    if (ascCount > 0) {
      parts.push(`${ascCount} ascending support line(s)`);
    }
    if (descCount > 0) {
      parts.push(`${descCount} descending resistance line(s)`);
    }

    const interacting = active.filter(
      (t) => t.lastInteraction !== "none"
    );
    for (const t of interacting) {
      parts.push(
        `${t.type === "ascending_support" ? "Support" : "Resistance"} line: ${t.lastInteraction}`
      );
    }

    if (parts.length === 0) {
      return "No significant trendlines detected.";
    }
    return parts.join(". ") + `. Trendline bias: ${bias}.`;
  }

  private emptyOutput(
    symbol: string,
    timeframe: string
  ): TrendlineEngineOutput {
    return {
      symbol,
      timeframe,
      activeTrendlines: [],
      nearbyTrendlines: [],
      trendlineCount: 0,
      trendlineBias: "neutral",
      summary: "Insufficient data for trendline analysis.",
      updatedAt: Date.now(),
    };
  }
}
