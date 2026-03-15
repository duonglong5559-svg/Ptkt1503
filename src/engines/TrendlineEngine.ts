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
const ZONE_TOLERANCE = 0.004;
const TOUCH_TOLERANCE_RATIO = 0.003;
const APPROACH_DISTANCE_RATIO = 0.008;
const BREAK_CONFIRM_RATIO = 0.002;

let lineIdCounter = 0;

export class TrendlineEngine {
  analyze(input: TrendlineEngineInput): TrendlineEngineOutput {
    const { candles, swings, currentPrice, currentIndex, symbol, timeframe } = input;

    if (swings.length < 2) {
      return this.emptyOutput(symbol, timeframe);
    }

    const closedCandles = candles.filter((c) => c.isClosed);
    const swingLows = swings.filter((s) => s.type === "low");
    const swingHighs = swings.filter((s) => s.type === "high");

    const levels = this.buildHorizontalLevels(swingHighs, swingLows, currentPrice, closedCandles, currentIndex);
    this.detectHorizontalInteractions(levels, currentPrice);
    levels.sort((a, b) => b.strength - a.strength);

    const activeTrendlines = levels
      .filter((t) => !t.isBroken && t.strength >= 30)
      .slice(0, MAX_ACTIVE_LINES);

    const nearbyTrendlines = levels
      .filter((t) => t.distanceToPricePercent < 2.0 && !activeTrendlines.includes(t) && t.strength >= 20)
      .slice(0, 3);

    const trendlineBias = this.computeBias(activeTrendlines, currentPrice);
    const summary = this.buildSummary(activeTrendlines, nearbyTrendlines, trendlineBias);

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

  private buildHorizontalLevels(
    highs: SwingPoint[],
    lows: SwingPoint[],
    currentPrice: number,
    candles: Candle[],
    currentIndex: number
  ): Trendline[] {
    const zones: Map<string, { price: number; type: TrendlineType; touches: number; swingIndices: number[]; strength: number }> = new Map();

    for (const sw of lows) {
      const key = this.findZoneKey(zones, sw.price);
      if (key) {
        const z = zones.get(key)!;
        z.price = (z.price * z.touches + sw.price) / (z.touches + 1);
        z.touches++;
        z.swingIndices.push(sw.index);
        z.strength = Math.min(100, z.strength + 12);
      } else {
        zones.set(`s_${sw.price.toFixed(2)}`, {
          price: sw.price,
          type: "horizontal_support",
          touches: 1,
          swingIndices: [sw.index],
          strength: 35,
        });
      }
    }

    for (const sw of highs) {
      const key = this.findZoneKey(zones, sw.price);
      if (key) {
        const z = zones.get(key)!;
        z.price = (z.price * z.touches + sw.price) / (z.touches + 1);
        z.touches++;
        z.swingIndices.push(sw.index);
        z.strength = Math.min(100, z.strength + 12);
      } else {
        zones.set(`r_${sw.price.toFixed(2)}`, {
          price: sw.price,
          type: "horizontal_resistance",
          touches: 1,
          swingIndices: [sw.index],
          strength: 35,
        });
      }
    }

    const result: Trendline[] = [];

    for (const [, zone] of zones) {
      if (zone.touches < 1) continue;
      const dist = currentPrice - zone.price;
      const distPercent = (Math.abs(dist) / currentPrice) * 100;
      if (distPercent > 5) continue;

      const firstIdx = Math.min(...zone.swingIndices);
      const lastIdx = Math.max(...zone.swingIndices);
      const span = lastIdx - firstIdx;

      let score = zone.strength;
      if (zone.touches >= 3) score += 15;
      else if (zone.touches >= 2) score += 8;
      if (span > 30) score += 10;
      else if (span > 15) score += 5;
      if (distPercent < 0.5) score += 12;
      else if (distPercent < 1.0) score += 8;
      else if (distPercent < 2.0) score += 4;

      const bodyTouches = this.countBodyTouches(candles, zone.price, currentIndex, zone.type);
      score += Math.min(15, bodyTouches * 5);

      result.push({
        id: `hz_${++lineIdCounter}`,
        type: zone.type,
        points: {
          x1: firstIdx,
          y1: zone.price,
          x2: Math.min(lastIdx + 20, currentIndex),
          y2: zone.price,
        },
        slope: 0,
        intercept: zone.price,
        touches: zone.touches + bodyTouches,
        strength: Math.min(100, score),
        isBroken: false,
        lastInteraction: "none",
        distanceToPrice: Math.round(dist * 100) / 100,
        distanceToPricePercent: Math.round(distPercent * 100) / 100,
        createdAt: Date.now(),
      });
    }

    return result;
  }

  private findZoneKey(
    zones: Map<string, { price: number }>,
    price: number
  ): string | undefined {
    for (const [key, zone] of zones) {
      if (Math.abs(zone.price - price) / price < ZONE_TOLERANCE) {
        return key;
      }
    }
    return undefined;
  }

  private countBodyTouches(
    candles: Candle[],
    levelPrice: number,
    currentIndex: number,
    type: TrendlineType
  ): number {
    let touches = 0;
    const tol = levelPrice * TOUCH_TOLERANCE_RATIO;
    const end = Math.min(currentIndex, candles.length - 1);
    const start = Math.max(0, end - 80);

    for (let i = start; i <= end; i++) {
      if (type === "horizontal_support" || type === "ascending_support") {
        if (Math.abs(candles[i].low - levelPrice) <= tol) touches++;
      } else {
        if (Math.abs(candles[i].high - levelPrice) <= tol) touches++;
      }
    }
    return touches;
  }

  private detectHorizontalInteractions(levels: Trendline[], currentPrice: number): void {
    for (const line of levels) {
      const price = line.intercept;
      const tol = price * TOUCH_TOLERANCE_RATIO;
      const approachDist = price * APPROACH_DISTANCE_RATIO;
      const breakDist = price * BREAK_CONFIRM_RATIO;
      const dist = currentPrice - price;
      const absDist = Math.abs(dist);

      line.distanceToPrice = Math.round(dist * 100) / 100;
      line.distanceToPricePercent = Math.round((absDist / currentPrice) * 100 * 100) / 100;

      if (line.type === "horizontal_support") {
        if (dist < -breakDist) {
          line.isBroken = true;
          line.lastInteraction = "break";
        } else if (absDist <= tol) {
          line.lastInteraction = "touch";
        } else if (dist > 0 && dist <= approachDist) {
          line.lastInteraction = "approaching";
        } else if (dist > approachDist) {
          line.lastInteraction = "bounce";
        }
      } else {
        if (dist > breakDist) {
          line.isBroken = true;
          line.lastInteraction = "break";
        } else if (absDist <= tol) {
          line.lastInteraction = "touch";
        } else if (dist < 0 && absDist <= approachDist) {
          line.lastInteraction = "approaching";
        } else if (dist < -approachDist) {
          line.lastInteraction = "bounce";
        }
      }
    }
  }

  private computeBias(trendlines: Trendline[], currentPrice: number): "bullish" | "bearish" | "neutral" {
    let bullPoints = 0;
    let bearPoints = 0;

    for (const line of trendlines) {
      const isSup = line.type === "horizontal_support" || line.type === "ascending_support";
      const isRes = line.type === "horizontal_resistance" || line.type === "descending_resistance";

      if (isSup && !line.isBroken) bullPoints += line.strength;
      if (isRes && !line.isBroken) bearPoints += line.strength;
      if (isSup && line.isBroken) bearPoints += line.strength * 0.7;
      if (isRes && line.isBroken) bullPoints += line.strength * 0.7;
    }

    const diff = bullPoints - bearPoints;
    if (Math.abs(diff) < 15) return "neutral";
    return diff > 0 ? "bullish" : "bearish";
  }

  private buildSummary(active: Trendline[], nearby: Trendline[], bias: "bullish" | "bearish" | "neutral"): string {
    const parts: string[] = [];
    const supCount = active.filter((t) => t.type.includes("support")).length;
    const resCount = active.filter((t) => t.type.includes("resistance")).length;

    if (supCount > 0) parts.push(`${supCount} vùng hỗ trợ`);
    if (resCount > 0) parts.push(`${resCount} vùng kháng cự`);

    const interacting = active.filter((t) => t.lastInteraction !== "none");
    for (const t of interacting) {
      const label = t.type.includes("support") ? "Hỗ trợ" : "Kháng cự";
      parts.push(`${label} ${t.intercept.toFixed(2)}: ${t.lastInteraction}`);
    }

    if (parts.length === 0) return "Chưa phát hiện vùng S/R đáng chú ý.";
    return parts.join(". ") + `.`;
  }

  private emptyOutput(symbol: string, timeframe: string): TrendlineEngineOutput {
    return {
      symbol,
      timeframe,
      activeTrendlines: [],
      nearbyTrendlines: [],
      trendlineCount: 0,
      trendlineBias: "neutral",
      summary: "Chưa đủ dữ liệu để phân tích S/R.",
      updatedAt: Date.now(),
    };
  }
}
