import { Injectable } from '@angular/core';
import type { Account, Category, Transaction } from '../models/finance.models';
import { AccountsService } from './accounts.service';
import { BudgetsService, type BudgetSummary } from './budgets.service';
import { CategoriesService } from './categories.service';
import { LoansService, type LoanSummary } from './loans.service';
import { SavingsGoalsService, type SavingsGoalProgress } from './savings-goals.service';
import { TransactionsService } from './transactions.service';

export interface ReportFilters {
  fromDate: string;
  toDate: string;
  accountId?: string;
  categoryId?: string;
}

export interface ReportBucket {
  key: string;
  label: string;
  incomePaise: number;
  expensePaise: number;
}

export interface ReportBreakdown {
  id: string;
  name: string;
  amountPaise: number;
}

export interface FinancialReport {
  filters: ReportFilters;
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  incomePaise: number;
  expensePaise: number;
  netCashFlowPaise: number;
  savingsRatePercent: number;
  averageDailyExpensePaise: number;
  periodDays: number;
  highestCategory?: ReportBreakdown;
  highestExpense?: Transaction;
  categorySpending: ReportBreakdown[];
  accountSpending: ReportBreakdown[];
  monthlyComparison: ReportBucket[];
  weeklySpending: ReportBucket[];
  yearlyOverview: ReportBucket[];
  loans: LoanSummary[];
  budgets: BudgetSummary[];
  savingsGoals: SavingsGoalProgress[];
}

const ELIGIBLE_TYPES = ['income', 'expense'] as const;
const MAX_PAGE_SIZE = 100;
const YEAR_COUNT = 5;

@Injectable({ providedIn: 'root' })
export class ReportsService {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
    private readonly loansService: LoansService,
    private readonly budgetsService: BudgetsService,
    private readonly savingsGoalsService: SavingsGoalsService,
  ) {}

  async generate(filters: ReportFilters): Promise<FinancialReport> {
    validateFilters(filters);
    const [transactions, accounts, categories, loans, budgets, savingsGoals] = await Promise.all([
      this.readEligibleTransactions(filters),
      this.accountsService.listAccounts(),
      this.categoriesService.list(),
      this.readLoanSummaries(filters),
      this.budgetsService.list(filters.toDate),
      this.savingsGoalsService.list(),
    ]);

    const incomeTransactions = transactions.filter((item) => item.type === 'income');
    const expenseTransactions = transactions.filter((item) => item.type === 'expense');
    const incomePaise = sumSafe(incomeTransactions.map(({ amountPaise }) => amountPaise));
    const expensePaise = sumSafe(expenseTransactions.map(({ amountPaise }) => amountPaise));
    const periodDays = daysBetween(filters.fromDate, filters.toDate) + 1;
    const monthlyComparison = aggregateByMonth(transactions, filters.fromDate, filters.toDate);
    const weeklySpending = aggregateLastDays(expenseTransactions, filters.toDate, 7);
    const yearlyStart = `${Number(filters.toDate.slice(0, 4)) - YEAR_COUNT + 1}-01-01`;
    const yearlyTransactions = filters.fromDate <= yearlyStart
      ? transactions.filter(({ occurredAt }) => occurredAt.slice(0, 10) >= yearlyStart)
      : await this.readEligibleTransactions({ ...filters, fromDate: yearlyStart });
    const yearlyOverview = aggregateByYear(yearlyTransactions, filters.toDate);
    const categorySpending = aggregateBreakdown(
      expenseTransactions,
      (transaction) => transaction.categoryId ?? '',
      categories,
    );
    const accountSpending = aggregateBreakdown(
      expenseTransactions,
      (transaction) => transaction.accountId ?? '',
      accounts,
    );
    const highestCategory = categorySpending[0];
    const highestExpense = [...expenseTransactions]
      .sort((left, right) => right.amountPaise - left.amountPaise)[0];
    const netCashFlowPaise = safeSubtract(incomePaise, expensePaise);

    return {
      filters: { ...filters },
      transactions,
      accounts,
      categories,
      incomePaise,
      expensePaise,
      netCashFlowPaise,
      savingsRatePercent: incomePaise === 0 ? 0 : (netCashFlowPaise / incomePaise) * 100,
      averageDailyExpensePaise: Math.round(expensePaise / periodDays),
      periodDays,
      highestCategory,
      highestExpense,
      categorySpending,
      accountSpending,
      monthlyComparison,
      weeklySpending,
      yearlyOverview,
      loans,
      budgets: budgets.filter(({ budget, periodStart }) => !budget.archivedAt && !!periodStart),
      savingsGoals,
    };
  }

  private async readEligibleTransactions(filters: ReportFilters): Promise<Transaction[]> {
    const groups = await Promise.all(ELIGIBLE_TYPES.map((type) =>
      this.readTypeTransactions(filters, type),
    ));
    return groups.flat()
      .filter((transaction) => !transaction.voidedAt)
      .sort((left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
      );
  }

  private async readLoanSummaries(filters: ReportFilters): Promise<Awaited<ReturnType<LoansService['list']>>['items']> {
    const items: Awaited<ReturnType<LoansService['list']>>['items'] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.loansService.list({
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        page,
        pageSize: MAX_PAGE_SIZE,
      });
      items.push(...result.items);
      if (items.length >= result.totalItems) return items;
    }
  }

  private async readTypeTransactions(
    filters: ReportFilters,
    type: (typeof ELIGIBLE_TYPES)[number],
  ): Promise<Transaction[]> {
    const results: Transaction[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.transactionsService.list({
        type,
        accountId: filters.accountId,
        categoryId: type === 'expense' ? filters.categoryId : undefined,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        sort: 'oldest',
        page,
        pageSize: MAX_PAGE_SIZE,
      });
      results.push(...result.items);
      if (results.length >= result.totalItems) break;
    }
    return results;
  }
}

function aggregateBreakdown<T extends { id: string; name: string }>(
  transactions: Transaction[],
  getId: (transaction: Transaction) => string,
  records: T[],
): ReportBreakdown[] {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    const id = getId(transaction);
    amounts.set(id, safeAdd(amounts.get(id) ?? 0, transaction.amountPaise));
  }
  return [...amounts.entries()]
    .map(([id, amountPaise]) => ({
      id,
      name: records.find((record) => record.id === id)?.name ?? (id ? 'Archived item' : 'Uncategorized'),
      amountPaise,
    }))
    .sort((left, right) => right.amountPaise - left.amountPaise);
}

function aggregateByMonth(transactions: Transaction[], fromDate: string, toDate: string): ReportBucket[] {
  const buckets = new Map<string, ReportBucket>();
  const firstMonth = fromDate.slice(0, 7);
  const lastMonth = toDate.slice(0, 7);
  for (let key = firstMonth; key <= lastMonth; key = nextMonth(key)) {
    buckets.set(key, {
      key,
      label: new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${key}-01T00:00:00.000Z`)),
      incomePaise: 0,
      expensePaise: 0,
    });
  }
  for (const transaction of transactions) {
    const key = transaction.occurredAt.slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (transaction.type === 'income') bucket.incomePaise = safeAdd(bucket.incomePaise, transaction.amountPaise);
    else bucket.expensePaise = safeAdd(bucket.expensePaise, transaction.amountPaise);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function nextMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

function aggregateLastDays(
  transactions: Transaction[],
  endDate: string,
  count: number,
): ReportBucket[] {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    const key = transaction.occurredAt.slice(0, 10);
    amounts.set(key, safeAdd(amounts.get(key) ?? 0, transaction.amountPaise));
  }
  return Array.from({ length: count }, (_, index) => {
    const key = addDays(endDate, index - count + 1);
    return {
      key,
      label: new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${key}T00:00:00.000Z`)),
      incomePaise: 0,
      expensePaise: amounts.get(key) ?? 0,
    };
  });
}

function aggregateByYear(transactions: Transaction[], endDate: string): ReportBucket[] {
  const lastYear = Number(endDate.slice(0, 4));
  const byYear = new Map<string, ReportBucket>();
  for (let year = lastYear - YEAR_COUNT + 1; year <= lastYear; year += 1) {
    const key = String(year);
    byYear.set(key, { key, label: key, incomePaise: 0, expensePaise: 0 });
  }
  for (const transaction of transactions) {
    const bucket = byYear.get(transaction.occurredAt.slice(0, 4));
    if (!bucket) continue;
    if (transaction.type === 'income') bucket.incomePaise = safeAdd(bucket.incomePaise, transaction.amountPaise);
    else bucket.expensePaise = safeAdd(bucket.expensePaise, transaction.amountPaise);
  }
  return [...byYear.values()];
}

function validateFilters(filters: ReportFilters): void {
  if (!isDateOnly(filters.fromDate) || !isDateOnly(filters.toDate)) {
    throw new Error('Choose a valid report date range.');
  }
  if (filters.fromDate > filters.toDate) throw new Error('Start date must be on or before end date.');
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sumSafe(values: number[]): number {
  return values.reduce((total, value) => safeAdd(total, value), 0);
}

function safeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(right)) throw new Error('Report data contains an invalid paise amount.');
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Report total exceeds safe integer precision.');
  return result;
}

function safeSubtract(left: number, right: number): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Report total exceeds safe integer precision.');
  return result;
}
