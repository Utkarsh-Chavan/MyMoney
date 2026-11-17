import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import { AccountsService } from './accounts.service';
import { BudgetsService, getBudgetPeriod } from './budgets.service';
import { CategoriesService } from './categories.service';
import { TransactionsService } from './transactions.service';

describe('budgets and recurring periods', () => {
  let database: MyMoneyDatabase;
  let databaseName: string;
  let accounts: AccountsService;
  let categories: CategoriesService;
  let budgets: BudgetsService;
  let transactions: TransactionsService;
  let accountId: string;
  let expenseCategoryId: string;
  let incomeCategoryId: string;

  beforeEach(async () => {
    databaseName = `mymoney-budgets-${crypto.randomUUID()}`;
    database = new MyMoneyDatabase(databaseName);
    accounts = new AccountsService(database);
    categories = new CategoriesService(database);
    budgets = new BudgetsService(database);
    transactions = new TransactionsService(database, categories);
    const account = await accounts.createAccount({
      name: 'Budget test account',
      type: 'savings-bank',
      openingBalancePaise: 1_000_000,
      openingDate: '2020-01-01',
    });
    accountId = account.id;
    await categories.ensureDefaults();
    const allCategories = await categories.list();
    expenseCategoryId = allCategories.find(({ appliesTo }) => appliesTo === 'expense')!.id;
    incomeCategoryId = allCategories.find(({ appliesTo }) => appliesTo === 'income')!.id;
  });

  afterEach(async () => { await database.delete(); });

  it('counts only expenses for the budget category and stores each threshold once per period', async () => {
    const budget = await budgets.create({
      name: 'Dining',
      categoryId: expenseCategoryId,
      amountPaise: 10_000,
      period: 'monthly',
      startsOn: '2025-01-01',
    });
    await transactions.create({
      type: 'expense',
      amountPaise: 10_000,
      accountId,
      categoryId: expenseCategoryId,
      occurredAt: '2025-01-15',
    });
    await transactions.create({
      type: 'income',
      amountPaise: 40_000,
      accountId,
      categoryId: incomeCategoryId,
      occurredAt: '2025-01-16',
    });

    const first = await budgets.list('2025-01-20');
    const second = await budgets.list('2025-01-21');
    const summary = first.find(({ budget: item }) => item.id === budget.id)!;
    expect(summary.spentPaise).toBe(10_000);
    expect(summary.percentUsed).toBe(100);
    expect(summary.alerts.map(({ thresholdPercent }) => thresholdPercent)).toEqual([50, 75, 90, 100]);
    expect(second.find(({ budget: item }) => item.id === budget.id)?.alerts).toHaveLength(4);
    expect(await database.budgetAlerts.where('budgetId').equals(budget.id).count()).toBe(4);
  });

  it('supports an overall monthly budget across expense categories only', async () => {
    const overall = await budgets.create({
      name: 'Monthly spending',
      amountPaise: 30_000,
      period: 'monthly',
      startsOn: '2025-01-01',
    });
    await transactions.create({
      type: 'expense',
      amountPaise: 12_000,
      accountId,
      categoryId: expenseCategoryId,
      occurredAt: '2025-01-05',
    });
    const otherExpenseCategory = (await categories.list()).find(
      ({ appliesTo, id }) => appliesTo === 'expense' && id !== expenseCategoryId,
    )!;
    await transactions.create({
      type: 'expense',
      amountPaise: 8_000,
      accountId,
      categoryId: otherExpenseCategory.id,
      occurredAt: '2025-01-20',
    });

    const summary = (await budgets.list('2025-01-25'))
      .find(({ budget }) => budget.id === overall.id)!;
    expect(summary.spentPaise).toBe(20_000);
    expect(summary.remainingPaise).toBe(10_000);
    expect(summary.percentUsed).toBeCloseTo(66.67, 1);
    await expect(budgets.create({
      name: 'Overall weekly',
      amountPaise: 30_000,
      period: 'weekly',
      startsOn: '2025-01-01',
    })).rejects.toThrow('monthly period');
  });

  it('records only the selected alert thresholds once per period', async () => {
    const budget = await budgets.create({
      name: 'Flexible alert plan',
      categoryId: expenseCategoryId,
      alertThresholds: [75, 100],
      amountPaise: 20_000,
      period: 'monthly',
      startsOn: '2025-01-01',
    });
    await transactions.create({
      type: 'expense',
      amountPaise: 11_000,
      accountId,
      categoryId: expenseCategoryId,
      occurredAt: '2025-01-05',
    });
    expect((await budgets.list('2025-01-06')).find(({ budget: item }) => item.id === budget.id)?.alerts)
      .toEqual([]);

    await transactions.create({
      type: 'expense',
      amountPaise: 5_000,
      accountId,
      categoryId: expenseCategoryId,
      occurredAt: '2025-01-07',
    });
    expect((await budgets.list('2025-01-08'))
      .find(({ budget: item }) => item.id === budget.id)?.alerts.map(({ thresholdPercent }) => thresholdPercent))
      .toEqual([75]);
    await budgets.list('2025-01-09');
    expect(await database.budgetAlerts.where('budgetId').equals(budget.id).count()).toBe(1);
  });

  it('uses custom period lengths and safely clamps monthly anchor days', async () => {
    const custom = getBudgetPeriod({
      period: 'custom',
      startsOn: '2025-01-01',
      customPeriodDays: 10,
    }, '2025-01-11');
    expect(custom).toEqual({ start: '2025-01-11', end: '2025-01-20' });

    const monthStart = getBudgetPeriod({
      period: 'monthly',
      startsOn: '2024-01-31',
    }, '2024-02-20');
    const nextMonthStart = getBudgetPeriod({
      period: 'monthly',
      startsOn: '2024-01-31',
    }, '2024-02-29');
    expect(monthStart).toEqual({ start: '2024-01-31', end: '2024-02-28' });
    expect(nextMonthStart).toEqual({ start: '2024-02-29', end: '2024-03-30' });
  });

  it('rejects income categories and invalid custom lengths', async () => {
    await expect(budgets.create({
      name: 'Not an expense budget',
      categoryId: incomeCategoryId,
      amountPaise: 1_000,
      period: 'weekly',
      startsOn: '2025-01-01',
    })).rejects.toThrow('expense category');
    await expect(budgets.create({
      name: 'Invalid custom period',
      categoryId: expenseCategoryId,
      amountPaise: 1_000,
      period: 'custom',
      customPeriodDays: 0,
      startsOn: '2025-01-01',
    })).rejects.toThrow('between 1 and 3660');
  });

  it('preserves version-four budget and savings records during the schema upgrade', async () => {
    await database.delete();
    databaseName = `mymoney-v4-budgets-${crypto.randomUUID()}`;
    const legacy = new Dexie(databaseName);
    legacy.version(4).stores({
      accounts: 'id, type, status, name, createdAt, archivedAt',
      transactions:
        'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
      ledgerEntries: 'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
      loans: 'id, direction, personId, personName, accountId, startedAt, dueDate, createdAt, settledAt',
      loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
      people: 'id, name, status, createdAt, updatedAt',
      categories: 'id, name, appliesTo, status',
      budgets: 'id, categoryId, period, startsOn, endsOn',
      savingsGoals: 'id, targetDate, linkedAccountId',
      settings: 'key',
    });
    await legacy.open();
    const oldBudget = {
      id: 'existing-budget',
      name: 'Existing plan',
      categoryId: 'old-category',
      amountPaise: 25_000,
      period: 'monthly' as const,
      startsOn: '2024-01-31',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const oldGoal = {
      id: 'existing-goal',
      name: 'Existing goal',
      targetAmountPaise: 100_000,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    await legacy.table('budgets').add(oldBudget);
    await legacy.table('savingsGoals').add(oldGoal);
    legacy.close();

    database = new MyMoneyDatabase(databaseName);
    await database.open();
    expect(await database.budgets.get(oldBudget.id)).toEqual(oldBudget);
    expect(await database.savingsGoals.get(oldGoal.id)).toEqual({ ...oldGoal, status: 'active' });
    expect(await database.budgetAlerts.count()).toBe(0);
    expect(await database.savingsGoalEntries.count()).toBe(0);
  });
});
