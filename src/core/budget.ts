import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

export const usdToAtomic = (usd: number): bigint => BigInt(Math.round(usd * 1_000_000));
export const atomicToUsd = (atomic: bigint): number => Number(atomic) / 1_000_000;

interface DayLedger {
  day: string;
  spentAtomic: string;
  calls: number;
}

const ledgerPath = () => path.join(config.dataDir, "spend.json");
const today = () => new Date().toISOString().slice(0, 10);

function readDay(): DayLedger {
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(), "utf8")) as DayLedger;
    if (raw.day === today()) return raw;
  } catch {
    // first run or unreadable ledger: start a fresh day
  }
  return { day: today(), spentAtomic: "0", calls: 0 };
}

function writeDay(ledger: DayLedger): void {
  if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2));
}

export function daySpend(): { day: string; spentUsd: number; calls: number; capUsd: number } {
  const d = readDay();
  return { day: d.day, spentUsd: atomicToUsd(BigInt(d.spentAtomic)), calls: d.calls, capUsd: config.maxUsdPerDay };
}

/**
 * Hard spend limits for one agent run plus a persisted daily cap.
 * A payment is reserved before it is signed, and either charged (the paid ask succeeded)
 * or released (the engine refused it before settlement).
 */
export class Budget {
  readonly runCap: bigint;
  readonly dayCap: bigint;
  private spent = 0n;
  private pending = 0n;
  calls = 0;

  constructor(runCapUsd = config.maxUsdPerRun, dayCapUsd = config.maxUsdPerDay) {
    this.runCap = usdToAtomic(runCapUsd);
    this.dayCap = usdToAtomic(dayCapUsd);
  }

  get spentUsd(): number {
    return atomicToUsd(this.spent);
  }

  get remainingUsd(): number {
    const left = this.runCap - this.spent - this.pending;
    return atomicToUsd(left > 0n ? left : 0n);
  }

  /** Returns a refusal reason, or undefined when the amount was reserved. */
  reserve(amount: bigint): string | undefined {
    if (this.spent + this.pending + amount > this.runCap) {
      return `run budget exhausted: $${this.spentUsd.toFixed(4)} spent of $${atomicToUsd(this.runCap).toFixed(2)}`;
    }
    const day = readDay();
    if (BigInt(day.spentAtomic) + this.pending + amount > this.dayCap) {
      return `daily budget exhausted: $${atomicToUsd(BigInt(day.spentAtomic)).toFixed(4)} spent of $${atomicToUsd(this.dayCap).toFixed(2)} today`;
    }
    this.pending += amount;
    return undefined;
  }

  settle(amount: bigint, charged: boolean): void {
    this.pending -= amount;
    if (this.pending < 0n) this.pending = 0n;
    if (!charged) return;
    this.spent += amount;
    this.calls += 1;
    const day = readDay();
    writeDay({ day: day.day, spentAtomic: String(BigInt(day.spentAtomic) + amount), calls: day.calls + 1 });
  }

  canAfford(amount: bigint): boolean {
    return this.spent + this.pending + amount <= this.runCap;
  }
}
