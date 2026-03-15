import { SwingPoint } from "../types";

export type SRLevel = {
  price: number;
  type: "support" | "resistance";
  touches: number;
  strength: number;
};

export type SRContext = {
  nearestSupport?: number;
  nearestResistance?: number;
  supportDistance?: number;
  resistanceDistance?: number;
  levels: SRLevel[];
};

export function computeSRLevels(
  swingHighs: SwingPoint[],
  swingLows: SwingPoint[],
  currentPrice: number,
  tolerance: number = 0.005
): SRContext {
  const zones: Map<number, SRLevel> = new Map();

  for (const sw of swingLows) {
    const existing = findNearZone(zones, sw.price, tolerance);
    if (existing) {
      existing.touches++;
      existing.price = (existing.price + sw.price) / 2;
      existing.strength = Math.min(100, existing.strength + 10);
    } else {
      zones.set(sw.price, {
        price: sw.price,
        type: "support",
        touches: 1,
        strength: 40,
      });
    }
  }

  for (const sw of swingHighs) {
    const existing = findNearZone(zones, sw.price, tolerance);
    if (existing) {
      existing.touches++;
      existing.price = (existing.price + sw.price) / 2;
      existing.strength = Math.min(100, existing.strength + 10);
    } else {
      zones.set(sw.price, {
        price: sw.price,
        type: "resistance",
        touches: 1,
        strength: 40,
      });
    }
  }

  const levels = Array.from(zones.values()).sort((a, b) => a.price - b.price);

  let nearestSup: number | undefined;
  let nearestRes: number | undefined;
  let supDist: number | undefined;
  let resDist: number | undefined;

  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i].price < currentPrice) {
      nearestSup = levels[i].price;
      supDist = currentPrice - levels[i].price;
      break;
    }
  }

  for (const lvl of levels) {
    if (lvl.price > currentPrice) {
      nearestRes = lvl.price;
      resDist = lvl.price - currentPrice;
      break;
    }
  }

  return {
    nearestSupport: nearestSup,
    nearestResistance: nearestRes,
    supportDistance: supDist,
    resistanceDistance: resDist,
    levels,
  };
}

function findNearZone(
  zones: Map<number, SRLevel>,
  price: number,
  tolerance: number
): SRLevel | undefined {
  for (const [key, zone] of zones) {
    if (Math.abs(zone.price - price) / price < tolerance) {
      return zone;
    }
  }
  return undefined;
}
