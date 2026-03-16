import { AssertFn } from "./helpers";
import { SymbolMapping } from "../src/services/SymbolMapping";

export function testSymbolMapping(assert: AssertFn): void {
  // PAXGUSDT is supported
  assert(SymbolMapping.isSupported("PAXGUSDT"), "PAXGUSDT is supported");
  assert(SymbolMapping.isSupported("BTCUSDT"), "BTCUSDT is supported");
  assert(SymbolMapping.isSupported("ETHUSDT"), "ETHUSDT is supported");
  assert(!SymbolMapping.isSupported("XAUUSDT"), "XAUUSDT is NOT supported");
  assert(!SymbolMapping.isSupported("DOGEUSDT"), "DOGEUSDT is NOT supported");

  // Display labels
  assert(SymbolMapping.getDisplay("PAXGUSDT") === "PAXG/USDT", "PAXG display correct");
  assert(SymbolMapping.getDisplayLabel("PAXGUSDT") === "PAXG/USDT - Vàng", "PAXG label includes Vàng");
  assert(SymbolMapping.getDisplayLabel("BTCUSDT") === "BTC/USDT", "BTC label correct");

  // Asset mapping
  assert(SymbolMapping.getAsset("PAXGUSDT") === "PAXG", "PAXG asset is PAXG");
  assert(SymbolMapping.getAsset("BTCUSDT") === "BTC", "BTC asset is BTC");

  // Descriptor lookup
  const paxg = SymbolMapping.get("PAXGUSDT");
  assert(paxg !== undefined, "PAXG descriptor exists");
  assert(paxg!.category === "gold_proxy", "PAXG category is gold_proxy");
  assert(paxg!.asset === "PAXG", "PAXG asset field correct");

  const btc = SymbolMapping.get("BTCUSDT");
  assert(btc !== undefined, "BTC descriptor exists");
  assert(btc!.category === "crypto", "BTC category is crypto");

  // Case insensitive
  assert(SymbolMapping.isSupported("paxgusdt"), "Case insensitive support check");

  // All symbols
  const all = SymbolMapping.all();
  assert(all.length === 3, "Exactly 3 supported symbols");
  assert(all.some(s => s.symbol === "PAXGUSDT"), "PAXGUSDT in all()");

  // Unknown symbol fallback
  assert(SymbolMapping.getDisplay("UNKNOWN") === "UNKNOWN", "Unknown symbol returns itself");
}
