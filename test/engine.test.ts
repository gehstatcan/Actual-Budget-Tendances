import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSpending, normalizeTransactions, type ActualTransaction } from "../src/engine.ts";
import { pythonStyleTransactions } from "./fixtures.ts";

const tx = (id: string, month: string, amount: number, category: string | null = "food", extra: Partial<ActualTransaction> = {}): ActualTransaction => ({
  id, date: `${month}-15`, amount, account: "checking", category, ...extra,
});

 test("normalizes expenses positive and refunds negative without absolute-value repair", () => {
  const rows = [tx("buy", "2025-01", -10000), tx("refund", "2025-01", 12000)];
  const normalized = normalizeTransactions(rows);
  assert.deepEqual(normalized.map((row) => row.amountCents), [10000, -12000]);
  const result = analyzeSpending(rows, { currentMonth: "2025-03", tolerance: 1 });
  assert.equal(result.categories[0]?.monthly[0]?.amountCents, -2000);
});

test("expands split children, ignores parent totals, and deduplicates child rows", () => {
  const childA = tx("child-a", "2025-01", -4000, "food", { is_child: true, parent_id: "parent" });
  const childB = tx("child-b", "2025-01", -6000, "home", { is_child: true, parent_id: "parent" });
  const parent = tx("parent", "2025-01", -10000, null, { is_parent: true, subtransactions: [childA, childB] });
  const result = normalizeTransactions([parent, childA, childB]);
  assert.deepEqual(result.map((row) => [row.transactionId, row.amountCents]), [["child-a", 4000], ["child-b", 6000]]);
});

test("excludes transfers, tombstones, off-budget accounts, and uncategorized rows by default", () => {
  const rows = [
    tx("transfer", "2025-01", -1000, "food", { transfer_id: "pair" }),
    tx("deleted", "2025-01", -1000, "food", { tombstone: true }),
    tx("off", "2025-01", -1000, "food", { account: "savings" }),
    tx("none", "2025-01", -1000, null),
    tx("kept", "2025-01", -2000),
  ];
  assert.deepEqual(normalizeTransactions(rows, { offBudgetAccountIds: new Set(["savings"]) }).map((row) => row.transactionId), ["kept"]);
  assert.equal(normalizeTransactions(rows, { offBudgetAccountIds: new Set(["savings"]), includeOffBudget: true }).length, 2);
});

test("fills zero months, excludes current month, and keeps anomalies in rolling averages", () => {
  const rows = [tx("a", "2025-01", -10000), tx("b", "2025-02", -11000), tx("c", "2025-03", -9000), tx("spike", "2025-04", -50000), tx("current", "2025-05", -20000)];
  const result = analyzeSpending(rows, { currentMonth: "2025-05", tolerance: 0.5 });
  const series = result.categories[0]!;
  assert.deepEqual(result.months, ["2025-01", "2025-02", "2025-03", "2025-04"]);
  assert.deepEqual(series.monthly.map((point) => point.amountCents), [10000, 11000, 9000, 50000]);
  assert.equal(series.monthly[3]?.anomaly, true);
  assert.equal(series.movingAveragesCents[3][3], 23333);
  assert.equal(series.trimmedMeanCents, 10000);
});

test("uses complete 3/6/12 point windows and returns null before each is ready", () => {
  const rows = Array.from({ length: 12 }, (_, i) => tx(`m${i}`, `2024-${String(i + 1).padStart(2, "0")}`, -1000));
  const series = analyzeSpending(rows, { currentMonth: "2025-01" }).categories[0]!;
  assert.deepEqual(series.movingAveragesCents[3].slice(0, 3), [null, null, 1000]);
  assert.equal(series.movingAveragesCents[6][5], 1000);
  assert.equal(series.movingAveragesCents[12][11], 1000);
});

test("handles empty input, no positive months, and range-only zero categories", () => {
  assert.deepEqual(analyzeSpending([], { currentMonth: "2025-01" }), { months: [], categories: [] });
  const rows = [tx("refund", "2024-12", 1000)];
  const result = analyzeSpending(rows, { currentMonth: "2025-01", startMonth: "2024-10", endMonth: "2024-12" });
  assert.deepEqual(result.categories[0]?.monthly.map((m) => m.amountCents), [0, 0, -1000]);
  assert.equal(result.categories[0]?.typicalPositiveMonthCents, 0);
});

test("validates dates, integer cents, ranges, and tolerance", () => {
  assert.throws(() => normalizeTransactions([tx("bad-date", "2025-02", -1, "food", { date: "2025-02-30" })]), /invalid date/);
  assert.throws(() => normalizeTransactions([tx("bad-cents", "2025-02", 1.5)]), /safe integer/);
  assert.throws(() => analyzeSpending([], { currentMonth: "2025-01", tolerance: 1.1 }), /tolerance/);
  assert.deepEqual(analyzeSpending([tx("x", "2025-03", -1)], { currentMonth: "2025-01", startMonth: "2025-03", endMonth: "2025-04" }).months, []);
});

test("includes off-budget accounts when requested", () => {
  const rows = [tx("off", "2025-01", -2500, "food", { account: "savings" })];
  const result = analyzeSpending(rows, { currentMonth: "2025-03", offBudgetAccountIds: new Set(["savings"]), includeOffBudget: true });
  assert.equal(result.categories[0]?.monthly[0]?.amountCents, 2500);
});

test("contains representative Python-style series including gap and refund", () => {
  const result = analyzeSpending(pythonStyleTransactions, { currentMonth: "2025-08", tolerance: 0.5 });
  const series = result.categories[0]!;
  assert.deepEqual(result.months, ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"]);
  assert.deepEqual(series.monthly.map((point) => point.amountCents), [10000, 12000, 11000, 50000, -2000, 0, 12000]);
  assert.equal(series.monthly[3]?.anomaly, true);
});
