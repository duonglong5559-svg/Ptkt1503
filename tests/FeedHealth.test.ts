import { AssertFn } from "./helpers";
import { FeedHealthService } from "../src/services/FeedHealthService";
import { createInitialFeedHealth, computeAppPhase, checkStale } from "../src/types/feed";

export function testFeedHealth(assert: AssertFn): void {
  // Initial health state
  const initial = createInitialFeedHealth();
  assert(initial.restWarmup === "idle", "Initial restWarmup is idle");
  assert(initial.websocket === "disconnected", "Initial websocket is disconnected");
  assert(initial.stale === false, "Initial not stale");

  // Phase: cold_start
  assert(computeAppPhase(initial) === "cold_start", "Cold start phase from idle");

  // Phase: warmup
  const warming = { ...initial, restWarmup: "loading" as const };
  assert(computeAppPhase(warming) === "warmup", "Warmup phase from loading");

  // Phase: live
  const live = { ...initial, restWarmup: "ok" as const, websocket: "connected" as const };
  assert(computeAppPhase(live) === "live", "Live phase when rest ok + ws connected");

  // Phase: disconnected
  const disconnected = { ...initial, restWarmup: "ok" as const, websocket: "disconnected" as const };
  assert(computeAppPhase(disconnected) === "disconnected", "Disconnected phase");

  // Phase: error
  const error = { ...initial, restWarmup: "error" as const, websocket: "error" as const };
  assert(computeAppPhase(error) === "error", "Error phase when both fail");

  // Stale detection
  const now = Date.now();
  const oldData = { ...live, lastPriceUpdateAt: now - 6 * 60 * 1000 };
  const checked = checkStale(oldData, now);
  assert(checked.stale === true, "Stale detected after 6 minutes");
  assert(checked.staleReason !== undefined, "Stale reason provided");

  // Not stale with fresh data
  const freshData = { ...live, lastPriceUpdateAt: now - 30000 };
  const freshChecked = checkStale(freshData, now);
  assert(freshChecked.stale === false, "Not stale with 30s old data");

  // FeedHealthService transitions
  const service = new FeedHealthService();
  assert(service.getPhase() === "cold_start", "Service starts in cold_start");

  service.setRestWarmup("loading");
  assert(service.getPhase() === "warmup", "Service transitions to warmup");

  service.setRestWarmup("ok");
  assert(service.getHealth().restWarmup === "ok", "REST warmup set to ok");
  assert(service.getHealth().lastRestSyncAt !== null, "lastRestSyncAt recorded");

  service.setWebSocket("connected");
  assert(service.getPhase() === "live", "Service transitions to live");
  assert(service.getHealth().reconnecting === false, "Not reconnecting when connected");

  service.setWebSocket("reconnecting");
  assert(service.getHealth().reconnecting === true, "Reconnecting flag set");

  service.recordPriceUpdate();
  assert(service.getHealth().lastPriceUpdateAt !== null, "Price update recorded");

  service.recordFullAnalysis();
  assert(service.getHealth().lastFullAnalysisAt !== null, "Analysis recorded");

  service.recordTimeframeCandleClose("1h", 150);
  assert(service.getLoadedTimeframeCount() === 1, "Timeframe count tracks");

  service.setRestWarmup("error", "Network error");
  assert(service.getHealth().errorMessage === "Network error", "Error message stored");
}
