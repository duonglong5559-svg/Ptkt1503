import { BinanceFeed } from "./services/BinanceFeed";
import { Pipeline } from "./services/Pipeline";
import { CandleStateManager } from "./services/CandleStateManager";
import { UIPayload } from "./types";

const SYMBOL = process.env.SYMBOL || "BTCUSDT";
const TIMEFRAMES = ["15m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"];
const CANDLE_LIMIT = 200;

async function main() {
  console.log(`\n=== PTKT Engine Starting ===`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(", ")}`);
  console.log("");

  const feed = new BinanceFeed();
  const pipeline = new Pipeline(SYMBOL);
  const candleManager = new CandleStateManager();

  console.log("[Init] Loading historical data...");

  for (const tf of TIMEFRAMES) {
    try {
      const candles = await feed.fetchKlines(SYMBOL, tf, CANDLE_LIMIT);
      pipeline.initializeCache(tf, candles);
      console.log(`  ✓ ${tf}: ${candles.length} candles loaded`);
    } catch (err: any) {
      console.warn(`  ✗ ${tf}: failed to load (${err.message})`);
    }
  }

  const currentPrice = await feed.fetchPrice(SYMBOL);
  console.log(`\n[Init] Current price: ${currentPrice}`);

  console.log("\n[Init] Running initial full analysis...");
  const initialPayload = pipeline.runFullAnalysis(currentPrice);
  printPayload(initialPayload);

  let lastFullAnalysisTime = Date.now();
  let tickCount = 0;

  candleManager.setOnCandleClose((timeframe, candle) => {
    pipeline.updateCandle(timeframe, candle);
    console.log(
      `\n[CandleClose] ${timeframe} candle closed at ${candle.close} (${new Date(candle.closeTime).toISOString()})`
    );

    const payload = pipeline.runFullAnalysis(candle.close);
    lastFullAnalysisTime = Date.now();
    printPayload(payload);
  });

  console.log("\n[Stream] Subscribing to realtime data...");

  feed.subscribeKlines(
    SYMBOL,
    TIMEFRAMES,
    (symbol, timeframe, candle, isClose) => {
      const { closed } = candleManager.update(timeframe, candle);

      if (!closed) {
        pipeline.updateCandle(timeframe, candle);
        tickCount++;

        if (tickCount % 30 === 0) {
          const tickPayload = pipeline.runTickUpdate(candle.close);
          if (tickPayload) {
            process.stdout.write(
              `\r[Tick] ${candle.close.toFixed(2)} | Long ${tickPayload.globalBias.long}% / Short ${tickPayload.globalBias.short}%`
            );
          }
        }
      }
    },
    (symbol, price) => {
      // price updates handled above
    }
  );

  process.on("SIGINT", () => {
    console.log("\n\n[Shutdown] Closing connections...");
    feed.close();
    process.exit(0);
  });
}

function printPayload(payload: UIPayload): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${payload.symbol} | Price: ${payload.currentPrice.toFixed(2)}`);
  console.log("=".repeat(60));

  console.log(
    `\n  Global Bias: Long ${payload.globalBias.long}% / Short ${payload.globalBias.short}% → ${payload.globalBias.direction.toUpperCase()}`
  );

  console.log("\n  Timeframe Scores:");
  for (const [tf, data] of Object.entries(payload.timeframes)) {
    const bar = createBar(data.long, 20);
    console.log(`    ${tf.padEnd(4)} ${bar} L:${data.long} S:${data.short} [${data.bias}]`);
  }

  console.log(`\n  Trendlines active: ${payload.trendlineCount}`);
  console.log(`  Pivot: ${payload.pivotNarrative}`);

  console.log("\n  Signal:");
  console.log(`    State: ${payload.signal.state}`);
  console.log(`    Direction: ${payload.signal.direction}`);
  if (payload.signal.entryLong)
    console.log(`    Entry Long:  ${payload.signal.entryLong.toFixed(2)}`);
  if (payload.signal.entryShort)
    console.log(`    Entry Short: ${payload.signal.entryShort.toFixed(2)}`);
  if (payload.signal.stopLoss)
    console.log(`    Stop Loss:   ${payload.signal.stopLoss.toFixed(2)}`);
  if (payload.signal.takeProfit)
    console.log(`    Take Profit: ${payload.signal.takeProfit.toFixed(2)}`);
  if (payload.signal.target)
    console.log(`    Target:      ${payload.signal.target.toFixed(2)}`);

  console.log(`\n  Summary: ${payload.signal.summary}`);

  if (payload.signal.details.length > 0) {
    console.log("\n  Details:");
    for (const d of payload.signal.details) {
      console.log(`    • ${d}`);
    }
  }

  console.log("=".repeat(60) + "\n");
}

function createBar(longPct: number, width: number): string {
  const filled = Math.round((longPct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
