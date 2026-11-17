import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import { AccountsService } from './accounts.service';
import { AccountBalanceService } from './account-balance.service';
import { SavingsGoalsService } from './savings-goals.service';
import { CategoriesService } from './categories.service';
import { TransactionsService } from './transactions.service';

describe('savings goals', () => {
  let database: MyMoneyDatabase;
  let accounts: AccountsService;
  let balances: AccountBalanceService;
  let savings: SavingsGoalsService;
  let transactions: TransactionsService;
  let accountId: string;

  beforeEach(async () => {
    database = new MyMoneyDatabase(`mymoney-savings-${crypto.randomUUID()}`);
    accounts = new AccountsService(database);
    balances = new AccountBalanceService(database);
    savings = new SavingsGoalsService(database);
    transactions = new TransactionsService(database, new CategoriesService(database));
    const account = await accounts.createAccount({
      name: 'Savings test account',
      type: 'savings-bank',
      openingBalancePaise: 100_000,
      openingDate: '2020-01-01',
    });
    accountId = account.id;
  });

  afterEach(async () => { await database.delete(); });

  it('records allocation transfers and withdrawal history without income or expense transactions', async () => {
    const goal = await savings.create({
      name: 'Emergency fund',
      targetAmountPaise: 50_000,
      linkedAccountId: accountId,
    });
    const contribution = await savings.contribute(goal.id, {
      amountPaise: 20_000,
      accountId,
      occurredAt: '2025-01-10',
      notes: 'Monthly allocation',
    });
    const withdrawal = await savings.withdraw(goal.id, {
      amountPaise: 5_000,
      accountId,
      occurredAt: '2025-01-15',
    });

    expect(contribution.type).toBe('savings-contribution');
    expect(withdrawal.type).toBe('savings-withdrawal');
    expect(await balances.getBalance(accountId)).toBe(85_000);
    expect(await database.ledgerEntries.where('transactionId').equals(contribution.id).first())
      .toMatchObject({ amountPaise: -20_000 });
    expect(await database.ledgerEntries.where('transactionId').equals(withdrawal.id).first())
      .toMatchObject({ amountPaise: 5_000 });
    expect(await database.transactions.where('type').equals('income').count()).toBe(0);
    expect(await database.transactions.where('type').equals('expense').count()).toBe(0);
    const details = await savings.getDetails(goal.id);
    expect(details).toMatchObject({ savedPaise: 15_000, percentComplete: 30, remainingPaise: 35_000 });
    expect(details?.history).toHaveLength(2);
    await expect(transactions.delete(contribution.id)).rejects.toThrow('goal record');
  });

  it('rejects overdrafts and withdrawals above the tracked savings balance atomically', async () => {
    const goal = await savings.create({ name: 'Trip', targetAmountPaise: 20_000 });
    await expect(savings.contribute(goal.id, {
      amountPaise: 100_001,
      accountId,
      occurredAt: '2025-01-10',
    })).rejects.toThrow('available balance');
    expect(await database.transactions.count()).toBe(0);

    await savings.contribute(goal.id, { amountPaise: 10_000, accountId, occurredAt: '2025-01-10' });
    await expect(savings.withdraw(goal.id, {
      amountPaise: 10_001,
      accountId,
      occurredAt: '2025-01-11',
    })).rejects.toThrow('cannot exceed');
    expect(await savings.getDetails(goal.id)).toMatchObject({ savedPaise: 10_000 });
    expect(await balances.getBalance(accountId)).toBe(90_000);
  });

  it('updates completion as contributions and withdrawals change progress', async () => {
    const goal = await savings.create({ name: 'Camera', targetAmountPaise: 10_000 });
    await savings.contribute(goal.id, { amountPaise: 10_000, accountId, occurredAt: '2025-02-01' });
    expect(await database.savingsGoals.get(goal.id)).toMatchObject({ status: 'completed' });

    await savings.update(goal.id, { name: 'Camera', targetAmountPaise: 20_000 });
    expect(await database.savingsGoals.get(goal.id)).toMatchObject({ status: 'active' });
    await savings.contribute(goal.id, { amountPaise: 10_000, accountId, occurredAt: '2025-02-02' });
    await savings.withdraw(goal.id, { amountPaise: 1_000, accountId, occurredAt: '2025-02-03' });
    expect(await database.savingsGoals.get(goal.id)).toMatchObject({ status: 'active' });
    expect(await savings.getDetails(goal.id)).toMatchObject({
      savedPaise: 19_000,
      percentComplete: 95,
      remainingPaise: 1_000,
    });
  });

  it('archives completed goals without deleting their history and blocks further changes', async () => {
    const goal = await savings.create({ name: 'Course fund', targetAmountPaise: 5_000 });
    await savings.contribute(goal.id, { amountPaise: 5_000, accountId, occurredAt: '2025-03-01' });
    await savings.archive(goal.id);

    const archived = await database.savingsGoals.get(goal.id);
    expect(archived).toMatchObject({ status: 'archived' });
    expect(archived?.archivedAt).toBeTruthy();
    expect(await database.savingsGoalEntries.where('goalId').equals(goal.id).count()).toBe(1);
    expect(await savings.getDetails(goal.id)).toMatchObject({ goal: { status: 'archived' } });
    await expect(savings.contribute(goal.id, {
      amountPaise: 100,
      accountId,
      occurredAt: '2025-03-02',
    })).rejects.toThrow('Archived savings goals');
    await expect(savings.update(goal.id, { name: 'Course fund', targetAmountPaise: 5_000 }))
      .rejects.toThrow('Archived savings goals');
  });

  it('rejects archiving a goal before it reaches its target', async () => {
    const goal = await savings.create({ name: 'Laptop', targetAmountPaise: 10_000 });
    await expect(savings.archive(goal.id)).rejects.toThrow('Only completed');
    expect(await database.savingsGoals.get(goal.id)).toMatchObject({ status: 'active' });
  });
});
