/** A calendar month in sortable YYYY-MM form. */
export type Month = `${number}-${string}`;

/** The subset of Actual's transaction shape consumed by this engine. */
export interface ActualTransaction {
  id: string;
  date: string;
  amount: number;
  account: string;
  category?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  tombstone?: boolean;
  subtransactions?: ActualTransaction[];
}

export interface NormalizeOptions {
  /** Set of Actual account IDs marked off-budget. Defaults to no known off-budget accounts. */
  offBudgetAccountIds?: ReadonlySet<string>;
  /** Include identified off-budget accounts. Defaults to false. */
  includeOffBudget?: boolean;
  /** Keep transactions without a category in the null category bucket. Defaults to false. */
  includeUncategorized?: boolean;
}

/** One normalized, category-level cash flow. Expense is positive; refund is negative. */
export interface NormalizedTransaction {
  transactionId: string;
  date: string;
  month: Month;
  accountId: string;
  categoryId: string | null;
  amountCents: number;
  kind: "expense" | "refund";
}

export interface MonthAmount {
  month: Month;
  amountCents: number;
  anomaly: boolean;
}

export interface CategoryTrend {
  categoryId: string | null;
  monthly: MonthAmount[];
  movingAveragesCents: Record<3 | 6 | 12, (number | null)[]>;
  trimmedMeanCents: number | null;
  typicalPositiveMonthCents: number;
}

export interface AnalysisOptions extends NormalizeOptions {
  /** Inclusive first month YYYY-MM. Defaults to the first eligible transaction month. */
  startMonth?: Month;
  /** Inclusive last month YYYY-MM. Defaults to last eligible month, excluding current month. */
  endMonth?: Month;
  /** Deterministic override for the current month; defaults to the UTC month. */
  currentMonth?: Month;
  /** Relative tolerance in [0, 1]. 1 disables anomaly filtering, matching tendency.py. */
  tolerance?: number;
}

export interface SpendingAnalysis {
  months: Month[];
  categories: CategoryTrend[];
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}

function monthOf(date: string): Month {
  return date.slice(0, 7) as Month;
}

function validMonth(month: string): month is Month {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function previousMonth(month: Month): Month {
  const [year, number] = month.split("-").map(Number);
  const previousYear = number === 1 ? year - 1 : year;
  const previousMonthNumber = number === 1 ? 12 : number - 1;
  return `${previousYear}-${String(previousMonthNumber).padStart(2, "0")}` as Month;
}

function addMonth(month: Month): Month {
  const [year, number] = month.split("-").map(Number);
  const nextYear = number === 12 ? year + 1 : year;
  const nextMonth = number === 12 ? 1 : number + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}` as Month;
}

function monthRange(start: Month, end: Month): Month[] {
  const result: Month[] = [];
  for (let month = start; month <= end; month = addMonth(month)) result.push(month);
  return result;
}

function assertCents(value: number, id: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Transaction ${id} amount must be a safe integer number of cents`);
  }
}

/**
 * Normalize Actual rows into category-level flows. Parent rows are replaced by their child
 * fractions; transfers, tombstones, off-budget accounts (by default), and uncategorized rows
 * (by default) are ignored. Actual's negative expense becomes positive; a positive refund
 * becomes negative so it reduces the month's net spending.
 */
export function normalizeTransactions(
  rows: readonly ActualTransaction[],
  options: NormalizeOptions = {},
): NormalizedTransaction[] {
  const includeOffBudget = options.includeOffBudget ?? false;
  const includeUncategorized = options.includeUncategorized ?? false;
  const offBudget = options.offBudgetAccountIds ?? new Set<string>();
  const seen = new Set<string>();
  const result: NormalizedTransaction[] = [];

  const add = (row: ActualTransaction, inheritedAccount?: string): void => {
    if (row.tombstone) return;
    const accountId = row.account || inheritedAccount;
    if (!accountId) return;
    if (!includeOffBudget && offBudget.has(accountId)) return;
    if (row.transfer_id) return;
    if (!isValidDate(row.date)) throw new RangeError(`Transaction ${row.id} has invalid date: ${row.date}`);
    assertCents(row.amount, row.id);
    if (!row.category && !includeUncategorized) return;
    if (seen.has(row.id)) return;
    seen.add(row.id);
    result.push({
      transactionId: row.id,
      date: row.date,
      month: monthOf(row.date),
      accountId,
      categoryId: row.category ?? null,
      amountCents: -row.amount,
      kind: row.amount < 0 ? "expense" : "refund",
    });
  };

  for (const row of rows) {
    if (row.tombstone) continue;
    if (row.is_parent && row.subtransactions?.length) {
      for (const child of row.subtransactions) add(child, row.account);
      continue;
    }
    // A parent with no embedded children is not a category-level purchase line.
    if (row.is_parent) continue;
    add(row);
  }
  return result;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Round an integer-cent total divided by a positive count to the nearest cent. */
function meanCents(total: number, count: number): number | null {
  return count ? Math.round(total / count) : null;
}

function movingAverage(values: readonly number[], window: 3 | 6 | 12): (number | null)[] {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= window) sum -= values[index - window]!;
    return index + 1 < window ? null : meanCents(sum, window);
  });
}

/** Analyze normalized transactions, filling absent months with zero and excluding anomalies from the trimmed mean. */
export function analyzeSpending(
  rows: readonly ActualTransaction[],
  options: AnalysisOptions = {},
): SpendingAnalysis {
  const tolerance = options.tolerance ?? 1;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new RangeError("tolerance must be a number between 0 and 1");
  }
  const nowMonth = options.currentMonth ?? new Date().toISOString().slice(0, 7) as Month;
  if (!validMonth(nowMonth)) throw new RangeError(`Invalid currentMonth: ${nowMonth}`);

  const normalized = normalizeTransactions(rows, options);
  const dataMonths = normalized.map((item) => item.month).sort();
  const start = options.startMonth ?? dataMonths[0];
  const requestedEnd = options.endMonth ?? dataMonths[dataMonths.length - 1];
  if (start && !validMonth(start)) throw new RangeError(`Invalid startMonth: ${start}`);
  if (requestedEnd && !validMonth(requestedEnd)) throw new RangeError(`Invalid endMonth: ${requestedEnd}`);
  if (!start || !requestedEnd || start > requestedEnd) return { months: [], categories: [] };
  const end = requestedEnd >= nowMonth ? previousMonth(nowMonth) : requestedEnd;
  if (start > end) return { months: [], categories: [] };
  const months = monthRange(start, end);
  const ids = [...new Set(normalized
    .filter((item) => item.month >= start && item.month <= end)
    .map((item) => item.categoryId))];

  const categories = ids.map((categoryId): CategoryTrend => {
    const totals = new Map(months.map((month) => [month, 0]));
    for (const item of normalized) {
      if (item.categoryId === categoryId && totals.has(item.month)) {
        const next = totals.get(item.month)! + item.amountCents;
        if (!Number.isSafeInteger(next)) throw new RangeError("Monthly total exceeds JavaScript's safe integer range");
        totals.set(item.month, next);
      }
    }
    const real = months.map((month) => totals.get(month)!);
    const positive = real.filter((value) => value > 0);
    const typical = median(positive);
    const anomaly = (value: number) => value > 0 && tolerance < 1 &&
      (value < typical * (1 - tolerance) || value > typical * (1 + tolerance));
    const monthly = months.map((month, index) => ({ month, amountCents: real[index]!, anomaly: anomaly(real[index]!) }));
    const clean = real.filter((value) => !anomaly(value));
    return {
      categoryId,
      monthly,
      movingAveragesCents: {
        3: movingAverage(real, 3),
        6: movingAverage(real, 6),
        12: movingAverage(real, 12),
      },
      trimmedMeanCents: meanCents(clean.reduce((sum, value) => sum + value, 0), clean.length),
      typicalPositiveMonthCents: typical,
    };
  });
  return { months, categories };
}


