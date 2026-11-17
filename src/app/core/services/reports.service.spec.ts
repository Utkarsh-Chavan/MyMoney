import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import type { Transaction } from '../models/finance.models';
import { AccountsService } from './accounts.service';
import { BudgetsService } from './budgets.service';
import { CategoriesService } from './categories.service';
import { LoansService } from './loans.service';
import { ReportsExportService } from './reports-export.service';
import { ReportsService } from './reports.service';
import { SavingsGoalsService } from './savings-goals.service';
import { TransactionsService } from './transactions.service';

describe('financial reports', () => {
  let database: MyMoneyDatabase;
  let accounts: AccountsService;
  let categories: CategoriesService;
  let transactions: TransactionsService;
  let budgets: BudgetsService;
  let savings: SavingsGoalsService;
  let reports: ReportsService;
  let accountA: string;
  let accountB: string;
  let foodCategory: string;
  let travelCategory: string;
  let salaryCategory: string;

  beforeEach(async () => {
    database = new MyMoneyDatabase(`mymoney-reports-${crypto.randomUUID()}`);
    accounts = new AccountsService(database);
    categories = new CategoriesService(database);
    transactions = new TransactionsService(database, categories);
    const loans = new LoansService(database);
    budgets = new BudgetsService(database);
    savings = new SavingsGoalsService(database);
    reports = new ReportsService(transactions, accounts, categories, loans, budgets, savings);
    const [first, second] = await Promise.all([
      accounts.createAccount({
        name: 'Report account A',
        type: 'savings-bank',
        openingBalancePaise: 100_000,
        openingDate: '2020-01-01',
      }),
      accounts.createAccount({
        name: 'Report account B',
        type: 'cash-wallet',
        openingBalancePaise: 50_000,
        openingDate: '2020-01-01',
      }),
    ]);
    accountA = first.id;
    accountB = second.id;
    const allCategories = await categories.list();
    foodCategory = allCategories.find(({ name, appliesTo }) => name === 'Food' && appliesTo === 'expense')!.id;
    travelCategory = allCategories.find(({ name, appliesTo }) => name === 'Travel' && appliesTo === 'expense')!.id;
    salaryCategory = allCategories.find(({ name, appliesTo }) => name === 'Salary' && appliesTo === 'income')!.id;
  });

  afterEach(async () => { await database.delete(); });

  it('calculates daily and custom-range totals using income and expense entries only', async () => {
    await transactions.create({
      type: 'income', amountPaise: 10_000, accountId: accountA, categoryId: salaryCategory, occurredAt: '2025-01-01',
    });
    await transactions.create({
      type: 'expense', amountPaise: 2_000, accountId: accountA, categoryId: foodCategory, occurredAt: '2025-01-01',
      description: 'Groceries',
    });
    await transactions.create({
      type: 'expense', amountPaise: 3_000, accountId: accountB, categoryId: travelCategory, occurredAt: '2025-01-03',
      description: 'Train',
    });
    await addExcludedTransactions();

    expect(await transactions.list({ type: 'income', fromDate: '2025-01-01', toDate: '2025-01-01' }))
      .toMatchObject({ totalItems: 1 });
    const daily = await reports.generate({ fromDate: '2025-01-01', toDate: '2025-01-01' });
    expect(daily).toMatchObject({
      incomePaise: 10_000,
      expensePaise: 2_000,
      netCashFlowPaise: 8_000,
      savingsRatePercent: 80,
      averageDailyExpensePaise: 2_000,
      periodDays: 1,
      highestCategory: { id: foodCategory, amountPaise: 2_000 },
      highestExpense: { description: 'Groceries', amountPaise: 2_000 },
    });
    expect(daily.transactions).toHaveLength(2);

    const range = await reports.generate({ fromDate: '2025-01-01', toDate: '2025-01-07' });
    expect(range.incomePaise).toBe(10_000);
    expect(range.expensePaise).toBe(5_000);
    expect(range.averageDailyExpensePaise).toBe(714);
    expect(range.monthlyComparison).toHaveLength(1);
    expect(range.weeklySpending.reduce((total, bucket) => total + bucket.expensePaise, 0)).toBe(5_000);
  });

  it('applies account and category filters and includes zero months in monthly comparisons', async () => {
    await transactions.create({
      type: 'income', amountPaise: 9_000, accountId: accountA, categoryId: salaryCategory, occurredAt: '2025-01-10',
    });
    await transactions.create({
      type: 'expense', amountPaise: 1_000, accountId: accountA, categoryId: foodCategory, occurredAt: '2025-01-10',
    });
    await transactions.create({
      type: 'expense', amountPaise: 4_000, accountId: accountB, categoryId: travelCategory, occurredAt: '2025-03-10',
    });

    const filtered = await reports.generate({
      fromDate: '2025-01-01',
      toDate: '2025-03-31',
      accountId: accountA,
      categoryId: foodCategory,
    });
    expect(filtered.incomePaise).toBe(9_000);
    expect(filtered.expensePaise).toBe(1_000);
    expect(filtered.transactions.map(({ accountId: id }) => id)).toEqual([accountA, accountA]);
    expect(filtered.monthlyComparison.map(({ key, incomePaise, expensePaise }) =>
      [key, incomePaise, expensePaise])).toEqual([
      ['2025-01', 9_000, 1_000],
      ['2025-02', 0, 0],
      ['2025-03', 0, 0],
    ]);
    expect(filtered.yearlyOverview).toHaveLength(5);
  });

  it('handles yearly and empty reports, and rejects invalid date ranges', async () => {
    await transactions.create({
      type: 'income', amountPaise: 5_000, accountId: accountA, categoryId: salaryCategory, occurredAt: '2024-06-01',
    });
    const yearly = await reports.generate({ fromDate: '2024-01-01', toDate: '2024-12-31' });
    expect(yearly.incomePaise).toBe(5_000);
    expect(yearly.yearlyOverview.find(({ key }) => key === '2024')?.incomePaise).toBe(5_000);

    const empty = await reports.generate({ fromDate: '2025-04-01', toDate: '2025-04-30' });
    expect(empty).toMatchObject({
      incomePaise: 0,
      expensePaise: 0,
      netCashFlowPaise: 0,
      savingsRatePercent: 0,
      averageDailyExpensePaise: 0,
      highestCategory: undefined,
      highestExpense: undefined,
    });
    expect(empty.monthlyComparison).toEqual([
      { key: '2025-04', label: 'Apr 2025', incomePaise: 0, expensePaise: 0 },
    ]);
    await expect(reports.generate({ fromDate: '2025-02-01', toDate: '2025-01-01' }))
      .rejects.toThrow('on or before');
  });

  it('includes existing loan, budget and savings services in their respective report sections', async () => {
    await transactions.create({
      type: 'expense',
      amountPaise: 2_500,
      accountId: accountA,
      categoryId: foodCategory,
      occurredAt: '2025-01-10',
    });
    await budgets.create({
      name: 'Food plan',
      categoryId: foodCategory,
      amountPaise: 10_000,
      period: 'monthly',
      startsOn: '2025-01-01',
    });
    const goal = await savings.create({ name: 'Emergency fund', targetAmountPaise: 5_000 });
    await savings.contribute(goal.id, { amountPaise: 1_000, accountId: accountA, occurredAt: '2025-01-11' });
    const loans = new LoansService(database);
    const person = await loans.createPerson({ name: 'Report person' });
    await loans.createLoan({
      direction: 'lent',
      personId: person.id,
      amountPaise: 3_000,
      accountId: accountA,
      startedAt: '2025-01-12',
    });

    const report = await reports.generate({ fromDate: '2025-01-01', toDate: '2025-01-31' });
    expect(report.budgets).toHaveLength(1);
    expect(report.budgets[0]).toMatchObject({ spentPaise: 2_500 });
    expect(report.loans).toHaveLength(1);
    expect(report.loans[0]).toMatchObject({ outstandingPaise: 3_000 });
    expect(report.savingsGoals).toHaveLength(1);
    expect(report.savingsGoals[0]).toMatchObject({ savedPaise: 1_000 });
    expect(report.expensePaise).toBe(2_500);
    expect(report.incomePaise).toBe(0);
  });

  it('exports filtered transactions and report summaries as INR CSV and a PDF', async () => {
    await transactions.create({
      type: 'expense',
      amountPaise: 12_345,
      accountId: accountA,
      categoryId: foodCategory,
      occurredAt: '2025-02-03',
      description: 'Market, "fresh"',
    });
    const report = await reports.generate({ fromDate: '2025-02-01', toDate: '2025-02-28' });
    const exporter = new ReportsExportService();
    const transactionCsv = exporter.transactionsCsv(report);
    const summaryCsv = exporter.summaryCsv(report);
    const pdf = exporter.createPdf(report);

    expect(transactionCsv).toContain('"Market, ""fresh"""');
    expect(transactionCsv).toContain('"−₹123.45"');
    expect(summaryCsv).toContain('"Total expenditure","₹123.45"');
    expect(summaryCsv).toContain('"Food","₹123.45"');
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(500);
  });

  async function addExcludedTransactions(): Promise<void> {
    const excludedTypes: Transaction['type'][] = [
      'transfer',
      'money-lent',
      'money-borrowed',
      'loan-repayment-received',
      'loan-repayment-made',
      'savings-contribution',
      'savings-withdrawal',
    ];
    const now = new Date().toISOString();
    await database.transactions.bulkAdd(excludedTypes.map((type, index): Transaction => ({
      id: `excluded-${index}`,
      type,
      amountPaise: 1_000_000,
      occurredAt: '2025-01-01',
      description: type,
      accountId: accountA,
      createdAt: now,
      updatedAt: now,
    })));
  }
});
