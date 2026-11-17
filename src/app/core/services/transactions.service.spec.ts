import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import type { Account } from '../models/finance.models';
import { AccountTransfersService } from './account-transfers.service';
import { CategoriesService } from './categories.service';
import { TransactionsService, type TransactionInput } from './transactions.service';

describe('transaction management', () => {
  let database: MyMoneyDatabase;
  let categories: CategoriesService;
  let transactions: TransactionsService;
  let account: Account;

  beforeEach(async () => {
    database = new MyMoneyDatabase(`mymoney-transactions-${crypto.randomUUID()}`);
    categories = new CategoriesService(database);
    transactions = new TransactionsService(database, categories);
    account = await createAccount(database, 'Main', 5_000);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('creates income and expense entries with exact signed paise balances', async () => {
    const salary = await categoryId(categories, 'Salary', 'income');
    const food = await categoryId(categories, 'Food', 'expense');
    const income = await transactions.create(input(account.id, 'income', 125_050, salary));
    const expense = await transactions.create({
      ...input(account.id, 'expense', 2_501, food),
      description: 'Lunch',
      notes: 'Team lunch',
      tags: ['Work', 'team', 'Work'],
      paymentMethod: 'upi',
    });

    expect(await calculateBalance(database, account)).toBe(127_549);
    expect(income.amountPaise).toBe(125_050);
    expect(expense.description).toBe('Lunch');
    expect(expense.notes).toBe('Team lunch');
    expect(expense.tags).toEqual(['Work', 'team']);
    expect(expense.paymentMethod).toBe('upi');
    expect(await database.ledgerEntries.where('transactionId').equals(income.id).first()).toMatchObject({
      amountPaise: 125_050,
    });
    expect(await database.ledgerEntries.where('transactionId').equals(expense.id).first()).toMatchObject({
      amountPaise: -2_501,
    });
  });

  it('uses the selected account and returns all balances independently', async () => {
    const otherAccount = await createAccount(database, 'Other', 1_000);
    const food = await categoryId(categories, 'Food', 'expense');
    await transactions.create(input(otherAccount.id, 'expense', 250, food));

    expect(await calculateBalance(database, account)).toBe(5_000);
    expect(await calculateBalance(database, otherAccount)).toBe(750);
  });

  it('edits transaction data and atomically recalculates its ledger entry', async () => {
    const salary = await categoryId(categories, 'Salary', 'income');
    const food = await categoryId(categories, 'Food', 'expense');
    const original = await transactions.create(input(account.id, 'income', 10_000, salary));
    const updated = await transactions.update(original.id, {
      ...input(account.id, 'expense', 3_000, food),
      occurredAt: '2025-02-02T12:00:00.000Z',
      description: 'Corrected purchase',
    });

    expect(updated.type).toBe('expense');
    expect(updated.description).toBe('Corrected purchase');
    expect(await calculateBalance(database, account)).toBe(2_000);
    expect(await database.ledgerEntries.where('transactionId').equals(original.id).count()).toBe(1);
    expect(await database.ledgerEntries.where('transactionId').equals(original.id).first()).toMatchObject({
      amountPaise: -3_000,
      occurredAt: '2025-02-02T12:00:00.000Z',
    });
  });

  it('restores the original transaction and ledger entry when an edit write fails', async () => {
    const salary = await categoryId(categories, 'Salary', 'income');
    const food = await categoryId(categories, 'Food', 'expense');
    const original = await transactions.create(input(account.id, 'income', 10_000, salary));
    const addEntry = database.ledgerEntries.add.bind(database.ledgerEntries);
    vi.spyOn(database.ledgerEntries, 'add').mockImplementation(async (entry) => {
      await addEntry(entry);
      throw new Error('Simulated edit write failure.');
    });

    await expect(
      transactions.update(original.id, input(account.id, 'expense', 2_500, food)),
    ).rejects.toThrow('Simulated edit write failure');
    expect((await transactions.get(original.id))?.type).toBe('income');
    expect(await database.ledgerEntries.where('transactionId').equals(original.id).count()).toBe(1);
    expect((await database.ledgerEntries.where('transactionId').equals(original.id).first())?.amountPaise).toBe(
      10_000,
    );
    expect(await calculateBalance(database, account)).toBe(15_000);
  });

  it('deletes a transaction and its ledger entry together', async () => {
    const food = await categoryId(categories, 'Food', 'expense');
    const expense = await transactions.create(input(account.id, 'expense', 1_250, food));
    await transactions.delete(expense.id);

    expect(await database.transactions.get(expense.id)).toBeUndefined();
    expect(await database.ledgerEntries.where('transactionId').equals(expense.id).count()).toBe(0);
    expect(await calculateBalance(database, account)).toBe(5_000);
  });

  it('deletes both ledger entries when a transfer is deleted from transaction history', async () => {
    const destination = await createAccount(database, 'Destination', 1_000);
    const transferService = new AccountTransfersService(database);
    const transfer = await transferService.createTransfer({
      fromAccountId: account.id,
      toAccountId: destination.id,
      amountPaise: 1_500,
      occurredAt: '2025-02-01T12:00:00.000Z',
    });

    await transactions.delete(transfer.id);
    expect(await database.transactions.get(transfer.id)).toBeUndefined();
    expect(await database.ledgerEntries.where('transactionId').equals(transfer.id).count()).toBe(0);
    expect(await calculateBalance(database, account)).toBe(5_000);
    expect(await calculateBalance(database, destination)).toBe(1_000);
  });

  it('rolls back deletion if removing the transaction record fails', async () => {
    const food = await categoryId(categories, 'Food', 'expense');
    const expense = await transactions.create(input(account.id, 'expense', 1_250, food));
    const originalDelete = database.transactions.delete.bind(database.transactions);
    vi.spyOn(database.transactions, 'delete').mockImplementation(async (id) => {
      await originalDelete(id);
      throw new Error('Simulated delete failure.');
    });

    await expect(transactions.delete(expense.id)).rejects.toThrow('Simulated delete failure');
    expect(await database.transactions.get(expense.id)).toBeDefined();
    expect(await database.ledgerEntries.where('transactionId').equals(expense.id).count()).toBe(1);
  });

  it('rejects categories of the wrong type and archived accounts', async () => {
    const salary = await categoryId(categories, 'Salary', 'income');
    await expect(
      transactions.create(input(account.id, 'expense', 100, salary)),
    ).rejects.toThrow('This category is for income, not expense');

    await database.accounts.update(account.id, { status: 'archived' });
    const food = await categoryId(categories, 'Food', 'expense');
    await expect(
      transactions.create(input(account.id, 'expense', 100, food)),
    ).rejects.toThrow('Archived accounts');
    expect(await database.transactions.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
  });

  it('creates, edits, archives, and deduplicates custom categories', async () => {
    const category = await categories.create({ name: '  Pet care ', appliesTo: 'expense' });
    expect(category.name).toBe('Pet care');
    await expect(categories.create({ name: 'pet CARE', appliesTo: 'expense' })).rejects.toThrow(
      'already exists',
    );

    const renamed = await categories.update(category.id, 'Veterinary');
    expect(renamed.name).toBe('Veterinary');
    const archived = await categories.archive(category.id);
    expect(archived.status).toBe('archived');
    await expect(categories.update((await categoryId(categories, 'Food', 'expense')), 'Meals')).rejects.toThrow(
      'Default categories',
    );
    expect((await categories.list('archived')).some(({ id }) => id === category.id)).toBe(true);
  });

  it('filters by date, description, account and type, then sorts and paginates', async () => {
    const food = await categoryId(categories, 'Food', 'expense');
    const salary = await categoryId(categories, 'Salary', 'income');
    await transactions.create({
      ...input(account.id, 'expense', 100, food),
      occurredAt: '2025-01-10T12:00:00.000Z',
      description: 'Coffee',
    });
    await transactions.create({
      ...input(account.id, 'income', 200, salary),
      occurredAt: '2025-02-10T12:00:00.000Z',
      description: 'Coffee refund',
    });
    await transactions.create({
      ...input(account.id, 'expense', 300, food),
      occurredAt: '2025-03-10T12:00:00.000Z',
      description: 'Books',
    });

    const results = await transactions.list({
      search: 'coffee',
      accountId: account.id,
      type: 'expense',
      fromDate: '2025-01-01',
      toDate: '2025-02-28',
      sort: 'oldest',
      page: 1,
      pageSize: 1,
    });
    expect(results.totalItems).toBe(1);
    expect(results.items[0]?.description).toBe('Coffee');
    expect(results.page).toBe(1);
    expect(results.pageSize).toBe(1);
  });

  it('rolls back a transaction if its ledger entry cannot be stored', async () => {
    const food = await categoryId(categories, 'Food', 'expense');
    const addEntry = database.ledgerEntries.add.bind(database.ledgerEntries);
    vi.spyOn(database.ledgerEntries, 'add').mockImplementation(async (entry) => {
      await addEntry(entry);
      throw new Error('Simulated ledger write failure.');
    });

    await expect(transactions.create(input(account.id, 'expense', 100, food))).rejects.toThrow(
      'Simulated ledger write failure',
    );
    expect(await database.transactions.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
  });

  it('preserves transaction history after closing and reopening IndexedDB', async () => {
    const salary = await categoryId(categories, 'Salary', 'income');
    const saved = await transactions.create(input(account.id, 'income', 123_456, salary));
    const databaseName = database.name;
    database.close();
    database = new MyMoneyDatabase(databaseName);
    categories = new CategoriesService(database);
    transactions = new TransactionsService(database, categories);

    expect((await transactions.get(saved.id))?.amountPaise).toBe(123_456);
    expect((await transactions.list()).totalItems).toBe(1);
  });
});

async function createAccount(
  database: MyMoneyDatabase,
  name: string,
  openingBalancePaise: number,
): Promise<Account> {
  const now = new Date().toISOString();
  const account: Account = {
    id: crypto.randomUUID(),
    name,
    type: 'savings-bank',
    currency: 'INR',
    openingBalancePaise,
    openingDate: '2025-01-01',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await database.accounts.add(account);
  return account;
}

async function categoryId(
  categories: CategoriesService,
  name: string,
  appliesTo: 'income' | 'expense',
): Promise<string> {
  const category = (await categories.list('active', appliesTo)).find((candidate) => candidate.name === name);
  if (!category) throw new Error(`Default category ${name} is missing.`);
  return category.id;
}

async function calculateBalance(database: MyMoneyDatabase, account: Account): Promise<number> {
  const entries = await database.ledgerEntries.where('accountId').equals(account.id).toArray();
  return entries.reduce((balance, entry) => balance + entry.amountPaise, account.openingBalancePaise);
}

function input(
  accountId: string,
  type: 'income' | 'expense',
  amountPaise: number,
  categoryId: string,
): TransactionInput {
  return {
    type,
    amountPaise,
    accountId,
    categoryId,
    occurredAt: '2025-01-01T12:00:00.000Z',
  };
}
