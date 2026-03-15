# PTKT Engine - Technical Analysis Engine

Trading analysis engine with 5 core modules: **PatternEngine**, **PivotEngine**, **TrendlineEngine**, **ScoringEngine**, **SignalEngine**. Connects to Binance Futures API for real-time data.

## Architecture

```
Candle close / market update
  → Candle State Manager (tách nến sống vs nến đóng)
  → PatternEngine (phát hiện mô hình nến)
  → PivotEngine (tính pivot + quan hệ giá)
  → SwingEngine → TrendlineEngine (swing points + đường xu hướng)
  → StructureEngine (HH-HL / LH-LL / range)
  → ATR / Volatility / SR (phụ trợ)
  → ScoringEngine (chấm điểm từng timeframe)
  → Aggregator (gộp Long% / Short% toàn cục)
  → SignalEngine (entry / SL / TP / narrative)
  → UI Payload
```

## Project Structure

```
src/
├── types/          # Type definitions
│   ├── candle.ts   # Candle + CandleMetrics
│   ├── pattern.ts  # PatternSignal, PatternEngineInput/Output
│   ├── pivot.ts    # PivotLevels, PivotRelation, PivotState
│   ├── swing.ts    # SwingPoint, SwingEngineInput/Output
│   ├── trendline.ts # Trendline, TrendlineInteraction
│   ├── scoring.ts  # TimeframeScore, AggregatedScore, weights
│   ├── signal.ts   # TradingSignal, SignalState state machine
│   └── index.ts    # Re-exports + UIPayload + StructureState
├── engines/        # Core analysis engines
│   ├── PatternEngine.ts    # 9 candlestick patterns + context filter
│   ├── PivotEngine.ts      # Classic pivot + narrative
│   ├── SwingEngine.ts      # Swing high/low detection
│   ├── TrendlineEngine.ts  # Line creation + scoring + interaction
│   ├── StructureEngine.ts  # Market structure (BOS/CHOCH)
│   ├── ScoringEngine.ts    # Component scoring + aggregation
│   └── SignalEngine.ts     # State machine + entry/SL/TP
├── services/       # Infrastructure
│   ├── BinanceFeed.ts      # Binance Futures REST + WebSocket
│   ├── CandleStateManager.ts # Forming/closed candle tracking
│   └── Pipeline.ts         # Orchestrator connecting all engines
├── utils/          # Utilities
│   ├── atr.ts      # ATR, volatility, momentum
│   └── sr.ts       # Support/Resistance levels
└── index.ts        # Entry point
tests/              # Test suite (79 tests)
```

## 5 Core Modules

### 1. PatternEngine

Detects 9 candlestick patterns from OHLCV data with context-aware strength scoring.

**Input:** Candles (closed), trend hint, ATR, nearby S/R levels
**Output:** Pattern signals with direction, strength (0-100), confirmation status, context boost
**Patterns:** doji, hammer, shooting_star, bullish/bearish_engulfing, morning/evening_star, three_white_soldiers, three_black_crows

Context filter boosts strength when pattern appears near S/R, pivot, or aligns with trend.

### 2. PivotEngine

Calculates classic pivot levels and determines price-pivot relationship.

**Input:** Previous period H/L/C, current price, momentum direction
**Output:** Pivot levels (P, R1-R3, S1-S3), state, bias, target hint, Vietnamese narrative
**States:** above_pivot, below_pivot, at_pivot, approaching_from_below/above, rejected_from_pivot

### 3. SwingEngine + TrendlineEngine

SwingEngine finds swing highs/lows. TrendlineEngine builds and scores trendlines from swings.

**Input:** Candles + swing points + current price
**Output:** Active trendlines (max 5), interactions, bias
**Interactions:** none, approaching, touch, bounce, break, retest

### 4. ScoringEngine

Scores each timeframe across 7 components, then aggregates globally with timeframe weights.

**Components:** pattern, pivot, trendline, structure, momentum, volatility, SR proximity
**Weights:** 15m=1, 1h=2, 4h=3, 1d=5, 1w=6
**Output:** Long/Short scores per timeframe + global Long%/Short%

### 5. SignalEngine

State machine that converts scores into actionable trading signals.

**States:** idle → watch_long/short → ready → triggered → active → invalidated (+ cooldown)
**Output:** Entry, Stop Loss, Take Profit, target, Vietnamese narrative, detail breakdown

## Quick Start

```bash
npm install
npm test          # Run 79 tests
npm start         # Start with live Binance data (BTCUSDT default)
SYMBOL=ETHUSDT npm start  # Use different symbol
```

## UI Payload Format

The pipeline outputs a standardized JSON payload for frontend rendering:

```json
{
  "symbol": "BTCUSDT",
  "currentPrice": 69778.1,
  "globalBias": { "long": 31, "short": 69, "direction": "short" },
  "timeframes": {
    "15m": { "long": 45, "short": 55, "state": "mixed", "bias": "neutral" },
    "1h":  { "long": 30, "short": 70, "state": "bearish", "bias": "bearish" },
    "4h":  { "long": 20, "short": 80, "state": "bearish", "bias": "bearish" }
  },
  "signal": {
    "state": "watch_short",
    "direction": "short",
    "entryShort": 70463.55,
    "entryLong": 68792.94,
    "stopLoss": 70850.00,
    "target": 69200.00,
    "summary": "Giá đang ở phía dưới Pivot (70200.00), có xu hướng tiến về Pivot..."
  },
  "trendlineCount": 3,
  "pivotNarrative": "Giá đang ở phía dưới Pivot..."
}
```

## Processing Order

Signal confirmation only happens on candle close. Tick updates are lightweight (price relation only). Full engine re-run triggers on each candle close event across all timeframes.
