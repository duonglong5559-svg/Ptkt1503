# SC Crypto & Forex Trading — Real-Time Technical Analysis Engine

A **rule-based, real-time technical analysis** dashboard for cryptocurrency and gold-proxy markets.

Built with Binance market data → candle state management → multi-engine analysis pipeline → signal lifecycle → UI payload rendering.

**Live demo:** Deployed on Netlify

---

## Product Goal

This is a **real-time technical analysis product**, not a static chart or mock UI. The app:

- Connects to Binance market data (REST + WebSocket)
- Processes candles across **9 timeframes** with weighted scoring
- Runs 7 independent analysis engines producing quantitative signals
- Generates execution-style Vietnamese-language narratives
- Displays live feed health, scenarios, and confidence metrics
- Distinguishes clearly between **forming** and **closed** candle data

---

## Symbol Policy

| Internal Symbol | Display | Label | Asset | Category |
|----------------|---------|-------|-------|----------|
| `BTCUSDT` | BTC/USDT | BTC/USDT | BTC | crypto |
| `ETHUSDT` | ETH/USDT | ETH/USDT | ETH | crypto |
| `PAXGUSDT` | PAXG/USDT | PAXG/USDT - Vàng | PAXG | gold_proxy |

**PAXGUSDT is the canonical gold proxy** in this codebase. XAU is not used.

All symbol mappings are defined in `src/services/SymbolMapping.ts` and typed in `src/types/symbol.ts`.

---

## Timeframe Policy

All 9 timeframes are explicitly supported and weighted:

| Timeframe | Weight | Role |
|-----------|--------|------|
| 15m | 1 | Timing |
| 1h | 2 | Timing |
| 2h | 2 | Directional confirmation |
| 4h | 3 | Directional confirmation |
| 6h | 3 | Directional confirmation |
| 8h | 3 | Directional confirmation |
| 12h | 4 | Macro bias |
| 1d | 5 | Macro bias |
| 1w | 6 | Macro bias & invalidation |

Weights are defined in `src/types/scoring.ts` as `TIMEFRAME_WEIGHTS`.

---

## Candle Confirmation Policy

The system strictly distinguishes between **forming candles** (tick updates) and **closed candles** (confirmed data):

**Tick/intrabar updates allowed for:**
- Current price display
- Price distance to pivot/trendline
- Feed health updates
- Preview bias drift

**Only candle-close may confirm:**
- Candlestick pattern detection
- Trendline break/retest
- BOS / CHOCH / structure state changes
- Signal state transitions (watch → ready → triggered)
- Entry/SL/TP recomputation

`CandleStateManager` tracks forming vs closed candles per timeframe and emits `onCandleClose` callbacks.

---

## Architecture

```
Binance REST + WebSocket
        │
        ▼
   BrowserFeed / BinanceFeed
        │
        ▼
   CandleStateManager (forming vs closed)
        │
        ▼
   ┌────────────────────────────┐
   │         Pipeline           │
   │                            │
   │  Per-timeframe analysis:   │
   │  1. SwingEngine            │
   │  2. StructureEngine        │
   │  3. PivotEngine            │
   │  4. PatternEngine          │
   │  5. TrendlineEngine        │
   │  6. ATR / Volatility / SR  │
   │                            │
   │  Aggregation:              │
   │  7. ScoringEngine          │
   │  8. SignalEngine            │
   │                            │
   │  Context:                  │
   │  9. NewsService            │
   │  10. SentimentEngine       │
   │                            │
   │  Output: UIPayload         │
   └────────────────────────────┘
        │
        ▼
   Frontend (app.ts + chart)
```

---

## Core Engines

### PatternEngine
Detects 9 candlestick patterns (doji, hammer, shooting_star, bullish/bearish_engulfing, morning/evening_star, three_white_soldiers, three_black_crows) from **closed candles only**.

### PivotEngine
Computes classic pivot levels from previous daily candle. Returns state (above_pivot, below_pivot, approaching, rejected) and Vietnamese narrative.

### SwingEngine
Identifies swing highs/lows from closed candles with configurable lookback. Feeds StructureEngine and TrendlineEngine.

### TrendlineEngine
Builds ascending support / descending resistance lines from validated swings. Scores by touches, proximity, and strength. Tracks interactions: none, approaching, touch, bounce, break, retest. Max 5 active lines.

### StructureEngine
Determines market structure: uptrend, downtrend, range, breakout, breakdown, transition, BOS, CHOCH. Based on swing logic, candle-close confirmed.

### ScoringEngine
Per-timeframe scoring across 7 components (pattern, pivot, trendline, structure, momentum, volatility, SR). Aggregates all 9 timeframes with explicit weights. Applies neutral zone and penalty logic.

### SignalEngine
State-machine signal lifecycle:
```
idle → watch_long/short → ready_long/short → triggered → active → invalidated → cooldown
```
Generates entry/SL/TP, confidence, primary/alternative scenarios, and execution-style Vietnamese summaries.

---

## News + Sentiment Layer

- `NewsService` fetches from CryptoCompare API with 5-minute caching
- `SentimentEngine` classifies positive/neutral/negative per asset
- News is **contextual only** — does not influence technical signal generation
- Each `NewsItem` includes: id, asset, title, summary, source, publishedAt, sentiment, confidence, impact

---

## Feed Health

The app explicitly tracks connection and data freshness state:

```typescript
type FeedHealth = {
  restWarmup: "idle" | "loading" | "ok" | "error";
  websocket: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  reconnecting: boolean;
  lastPriceUpdateAt: number | null;
  lastFullAnalysisAt: number | null;
  lastRestSyncAt: number | null;
  stale: boolean;
  staleReason?: string;
  errorMessage?: string;
};
```

App phase is derived from health:
- **cold_start** → Initial load, no data yet
- **warmup** → REST data loading
- **live** → REST loaded + WebSocket connected
- **stale** → No new data for >5 minutes
- **disconnected** → WebSocket lost, REST data available
- **error** → Both REST and WebSocket failed

The UI displays a live health indicator on the chart and explicit degraded-state messaging.

---

## Signal Lifecycle

```
idle            → No directional preference
watch_long/short → Directional preference, waiting for location
ready_long/short → Strong confluence at setup zone
triggered       → Price interacts with setup zone
active          → Position/setup is considered live
invalidated     → Structure/price broke the premise
cooldown        → Prevents signal spam after failure
```

Each signal includes:
- Direction + confidence scores
- Entry/SL/TP levels
- Risk-reward ratio
- Primary + alternative scenario narratives
- Step-by-step execution cards with status

---

## UI Payload Contract

The pipeline emits a normalized `UIPayload` shape:

```typescript
{
  symbol: string;
  displaySymbol: string;             // "PAXG/USDT - Vàng"
  currentPrice: number;
  feedHealth: FeedHealth;
  globalBias: { long, short, direction };
  timeframes: Record<string, { long, short, state, bias }>;
  signal: {
    state, direction, confidenceLong, confidenceShort,
    entryLong, entryShort, stopLoss, takeProfit, target,
    summary, details[], primaryScenario, alternativeScenario
  };
  trendlineCount: number;
  pivotNarrative: string;
  news: NewsItem[];
  updatedAt: number;
}
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Run tests
npm test

# Node.js CLI (requires SYMBOL env var)
SYMBOL=BTCUSDT npm run start:node
```

Deployed automatically via Netlify from `dist/` directory.

---

## Known Limitations

- **Binance Futures API may be geo-blocked** in some regions (HTTP 451). The app falls back to Binance Vision → OKX.
- **PAXG/USDT liquidity** is lower than BTC/ETH, which may affect pattern detection quality.
- **News sentiment** uses keyword-based analysis, not NLP. Accuracy is approximate.
- **Structure detection** requires sufficient swing data (~20+ closed candles per timeframe).
- **Signal lifecycle** does not yet implement full triggered → active transitions for position tracking.
- **No backtesting** — this is a forward-looking analysis tool only.
