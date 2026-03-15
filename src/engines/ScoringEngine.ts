import {
  ScoringEngineInput,
  TimeframeScore,
  ScoreComponents,
  AggregatedScore,
  TIMEFRAME_WEIGHTS,
  PatternSignal,
  PivotRelation,
  TrendlineEngineOutput,
} from "../types";

const NEUTRAL_THRESHOLD = 8;

export class ScoringEngine {
  scoreTimeframe(input: ScoringEngineInput): TimeframeScore {
    const components: ScoreComponents = {
      pattern: 0,
      pivot: 0,
      trendline: 0,
      structure: 0,
      momentum: 0,
      volatility: 0,
      sr: 0,
    };

    const longComponents: ScoreComponents = { ...components };
    const shortComponents: ScoreComponents = { ...components };

    this.scorePatterns(input.patternSignals, longComponents, shortComponents);
    this.scorePivot(input.pivotRelation, longComponents, shortComponents);
    this.scoreTrendlines(input.trendlineOutput, longComponents, shortComponents);
    this.scoreStructure(input.structureState, longComponents, shortComponents);
    this.scoreMomentum(input.momentumScore, longComponents, shortComponents);
    this.scoreVolatility(input.volatilityScore, longComponents, shortComponents);
    this.scoreSR(input, longComponents, shortComponents);

    let rawLong = Object.values(longComponents).reduce((s, v) => s + v, 0);
    let rawShort = Object.values(shortComponents).reduce((s, v) => s + v, 0);

    const { adjustedLong, adjustedShort } = this.applyPenalties(
      rawLong,
      rawShort,
      input
    );

    const total = adjustedLong + adjustedShort || 1;
    const longScore = Math.round((adjustedLong / total) * 100);
    const shortScore = 100 - longScore;

    const diff = Math.abs(longScore - shortScore);
    let dominantBias: "bullish" | "bearish" | "neutral" = "neutral";
    if (diff >= NEUTRAL_THRESHOLD) {
      dominantBias = longScore > shortScore ? "bullish" : "bearish";
    }

    const confidence = Math.min(100, Math.max(20, 40 + diff));
    const summary = this.buildSummary(
      longScore,
      shortScore,
      dominantBias,
      longComponents,
      shortComponents,
      input
    );

    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      longScore,
      shortScore,
      dominantBias,
      components: {
        pattern: longComponents.pattern - shortComponents.pattern,
        pivot: longComponents.pivot - shortComponents.pivot,
        trendline: longComponents.trendline - shortComponents.trendline,
        structure: longComponents.structure - shortComponents.structure,
        momentum: longComponents.momentum - shortComponents.momentum,
        volatility: longComponents.volatility - shortComponents.volatility,
        sr: longComponents.sr - shortComponents.sr,
      },
      confidence,
      summary,
      updatedAt: Date.now(),
    };
  }

  aggregate(scores: TimeframeScore[]): AggregatedScore {
    if (scores.length === 0) {
      return {
        symbol: "",
        globalLongPercent: 50,
        globalShortPercent: 50,
        dominantBias: "neutral",
        timeframeScores: [],
        updatedAt: Date.now(),
      };
    }

    let weightedLong = 0;
    let weightedShort = 0;
    let totalWeight = 0;

    for (const s of scores) {
      const w = TIMEFRAME_WEIGHTS[s.timeframe] ?? 1;
      weightedLong += s.longScore * w;
      weightedShort += s.shortScore * w;
      totalWeight += w;
    }

    const globalTotal = weightedLong + weightedShort || 1;
    const globalLong = Math.round((weightedLong / globalTotal) * 100);
    const globalShort = 100 - globalLong;

    const diff = Math.abs(globalLong - globalShort);
    let bias: "bullish" | "bearish" | "neutral" = "neutral";
    if (diff >= 6) {
      bias = globalLong > globalShort ? "bullish" : "bearish";
    }

    return {
      symbol: scores[0].symbol,
      globalLongPercent: globalLong,
      globalShortPercent: globalShort,
      dominantBias: bias,
      timeframeScores: scores,
      updatedAt: Date.now(),
    };
  }

  private scorePatterns(
    patterns: PatternSignal[],
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    if (!patterns.length) return;

    for (const p of patterns) {
      const weight = p.strength / 100;
      const points = Math.round(12 * weight);

      if (p.direction === "bullish") {
        long.pattern += points;
      } else if (p.direction === "bearish") {
        short.pattern += points;
      } else {
        long.pattern += 1;
        short.pattern += 1;
      }
    }
  }

  private scorePivot(
    pivot: PivotRelation,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    switch (pivot.state) {
      case "above_pivot":
        long.pivot += 10;
        break;
      case "below_pivot":
        short.pivot += 10;
        break;
      case "approaching_pivot_from_below":
        long.pivot += 5;
        short.pivot += 2;
        break;
      case "approaching_pivot_from_above":
        short.pivot += 5;
        long.pivot += 2;
        break;
      case "at_pivot":
        long.pivot += 3;
        short.pivot += 3;
        break;
      case "rejected_from_pivot":
        if (pivot.directionBias === "bullish") {
          long.pivot += 8;
        } else {
          short.pivot += 8;
        }
        break;
    }
  }

  private scoreTrendlines(
    tl: TrendlineEngineOutput,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    for (const line of tl.activeTrendlines) {
      const w = line.strength / 100;

      if (line.type === "ascending_support" && !line.isBroken) {
        if (line.lastInteraction === "bounce") {
          long.trendline += Math.round(15 * w);
        } else if (line.lastInteraction === "approaching") {
          long.trendline += Math.round(8 * w);
        } else {
          long.trendline += Math.round(5 * w);
        }
      }

      if (line.type === "descending_resistance" && !line.isBroken) {
        if (line.lastInteraction === "bounce") {
          short.trendline += Math.round(15 * w);
        } else if (line.lastInteraction === "approaching") {
          short.trendline += Math.round(8 * w);
        } else {
          short.trendline += Math.round(5 * w);
        }
      }

      if (line.type === "ascending_support" && line.isBroken) {
        if (line.lastInteraction === "retest") {
          short.trendline += Math.round(18 * w);
        } else {
          short.trendline += Math.round(10 * w);
        }
      }

      if (line.type === "descending_resistance" && line.isBroken) {
        if (line.lastInteraction === "retest") {
          long.trendline += Math.round(18 * w);
        } else {
          long.trendline += Math.round(10 * w);
        }
      }
    }
  }

  private scoreStructure(
    state: string,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    switch (state) {
      case "HH-HL":
        long.structure += 20;
        break;
      case "LH-LL":
        short.structure += 20;
        break;
      case "breakout":
        long.structure += 15;
        break;
      case "breakdown":
        short.structure += 15;
        break;
      case "retest_up":
        long.structure += 12;
        break;
      case "retest_down":
        short.structure += 12;
        break;
      case "range":
        long.structure += 3;
        short.structure += 3;
        break;
      case "transition":
        long.structure += 5;
        short.structure += 5;
        break;
    }
  }

  private scoreMomentum(
    momentumScore: number | undefined,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    if (momentumScore === undefined) return;
    if (momentumScore > 60) {
      long.momentum += Math.round((momentumScore - 50) * 0.3);
    } else if (momentumScore < 40) {
      short.momentum += Math.round((50 - momentumScore) * 0.3);
    }
  }

  private scoreVolatility(
    volScore: number | undefined,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    if (volScore === undefined) return;
    if (volScore > 85) {
      long.volatility -= 3;
      short.volatility -= 3;
    } else if (volScore < 30) {
      long.volatility -= 1;
      short.volatility -= 1;
    }
  }

  private scoreSR(
    input: ScoringEngineInput,
    long: ScoreComponents,
    short: ScoreComponents
  ): void {
    if (!input.srContext) return;
    const { supportDistance, resistanceDistance } = input.srContext;
    const atr = input.atr || 1;

    if (resistanceDistance !== undefined && resistanceDistance < atr * 0.5) {
      long.sr -= 5;
    }
    if (supportDistance !== undefined && supportDistance < atr * 0.5) {
      short.sr -= 5;
    }

    if (supportDistance !== undefined && supportDistance < atr * 1.0) {
      long.sr += 3;
    }
    if (resistanceDistance !== undefined && resistanceDistance < atr * 1.0) {
      short.sr += 3;
    }
  }

  private applyPenalties(
    rawLong: number,
    rawShort: number,
    input: ScoringEngineInput
  ): { adjustedLong: number; adjustedShort: number } {
    let adjLong = Math.max(0, rawLong);
    let adjShort = Math.max(0, rawShort);

    if (input.srContext?.resistanceDistance !== undefined && input.atr) {
      if (input.srContext.resistanceDistance < input.atr * 0.3) {
        adjLong *= 0.85;
      }
    }
    if (input.srContext?.supportDistance !== undefined && input.atr) {
      if (input.srContext.supportDistance < input.atr * 0.3) {
        adjShort *= 0.85;
      }
    }

    if (input.volatilityScore !== undefined && input.volatilityScore > 90) {
      adjLong *= 0.9;
      adjShort *= 0.9;
    }

    return {
      adjustedLong: Math.max(5, adjLong),
      adjustedShort: Math.max(5, adjShort),
    };
  }

  private buildSummary(
    longScore: number,
    shortScore: number,
    bias: "bullish" | "bearish" | "neutral",
    longComp: ScoreComponents,
    shortComp: ScoreComponents,
    input: ScoringEngineInput
  ): string[] {
    const parts: string[] = [];
    parts.push(`${input.timeframe}: Long ${longScore} / Short ${shortScore} → ${bias}`);

    const netPattern = longComp.pattern - shortComp.pattern;
    if (Math.abs(netPattern) > 3) {
      parts.push(`Pattern: ${netPattern > 0 ? "bullish" : "bearish"} (${netPattern > 0 ? "+" : ""}${netPattern})`);
    }

    const netStructure = longComp.structure - shortComp.structure;
    if (Math.abs(netStructure) > 5) {
      parts.push(`Structure: ${netStructure > 0 ? "bullish" : "bearish"}`);
    }

    return parts;
  }
}
