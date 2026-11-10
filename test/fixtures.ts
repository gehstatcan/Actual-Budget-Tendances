import type { ActualTransaction } from "../src/engine.ts";

/** Small representative ledger adapted from the CSV workflow in tendance.py. */
export const pythonStyleTransactions: ActualTransaction[] = [
  { id: "g-jan", date: "2025-01-12", amount: -10000, account: "checking", category: "groceries" },
  { id: "g-feb", date: "2025-02-12", amount: -12000, account: "checking", category: "groceries" },
  { id: "g-mar", date: "2025-03-12", amount: -11000, account: "checking", category: "groceries" },
  { id: "g-apr", date: "2025-04-12", amount: -50000, account: "checking", category: "groceries" },
  { id: "g-may-refund", date: "2025-05-12", amount: 2000, account: "checking", category: "groceries" },
  { id: "g-jul", date: "2025-07-12", amount: -12000, account: "checking", category: "groceries" },
];
