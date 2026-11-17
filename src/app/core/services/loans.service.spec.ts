import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import type { Account } from '../models/finance.models';
import { AccountBalanceService } from './account-balance.service';
import { AccountsService } from './accounts.service';
import { LoansService } from './loans.service';
import { CategoriesService } from './categories.service';
import { TransactionsService } from './transactions.service';

describe('loan and debt management', () => {
  let database: MyMoneyDatabase;
  let databaseName: string;
  let accounts: AccountsService;
  let balances: AccountBalanceService;
  let loans: LoansService;
  let transactions: TransactionsService;
  let account: Account;

  beforeEach(async () => {
    databaseName = `mymoney-loans-${crypto.randomUUID()}`;
    database = new MyMoneyDatabase(databaseName);
    accounts = new AccountsService(database);
    balances = new AccountBalanceService(database);
    loans = new LoansService(database);
    transactions = new TransactionsService(database, new CategoriesService(database));
    account = await accounts.createAccount(accountInput('Main account', 100_000));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.delete();
  });

  it('records money lent and borrowed with correct account-ledger signs', async () => {
    const person = await loans.createPerson({ name: 'Jordan' });
    const lent = await loans.createLoan(loanInput(person.id, account.id, 'lent', 20_050));
    const otherAccount = await accounts.createAccount(accountInput('Second account', 10_000));
    const borrowed = await loans.createLoan(loanInput(person.id, otherAccount.id, 'borrowed', 7_500));
    const lentTransaction = await database.transactions.where('loanId').equals(lent.id).first();
    const borrowedTransaction = await database.transactions.where('loanId').equals(borrowed.id).first();
    const dashboard = await loans.getDashboardSummary();

    expect(await balances.getBalance(account.id)).toBe(79_950);
    expect(await balances.getBalance(otherAccount.id)).toBe(17_500);
    expect(lentTransaction).toMatchObject({
      type: 'money-lent',
      amountPaise: 20_050,
    });
    expect(await database.ledgerEntries.where('transactionId').equals(lentTransaction?.id ?? '').first()).toMatchObject({
      amountPaise: -20_050,
    });
    expect(borrowedTransaction).toMatchObject({
      type: 'money-borrowed',
      amountPaise: 7_500,
    });
    expect(await database.ledgerEntries.where('transactionId').equals(borrowedTransaction?.id ?? '').first()).toMatchObject({
      amountPaise: 7_500,
    });
    expect(dashboard).toMatchObject({
      totalLentPaise: 20_050,
      totalBorrowedPaise: 7_500,
      receivablePaise: 20_050,
      payablePaise: 7_500,
    });
    expect(await database.transactions.where('type').equals('income').count()).toBe(0);
    expect(await database.transactions.where('type').equals('expense').count()).toBe(0);
  });

  it('tracks multiple repayments, settles the loan, and rejects overpayment', async () => {
    const person = await loans.createPerson({ name: 'Alex' });
    const loan = await loans.createLoan(loanInput(person.id, account.id, 'lent', 30_000));
    const first = await loans.createRepayment(loan.id, {
      amountPaise: 10_000,
      accountId: account.id,
      occurredAt: '2025-02-02',
      notes: 'First part',
    });
    expect(first.type).toBe('loan-repayment-received');
    expect(await balances.getBalance(account.id)).toBe(80_000);
    expect((await loans.getLoan(loan.id))?.outstandingPaise).toBe(20_000);
    expect((await loans.getLoan(loan.id))?.status).toBe('partially-repaid');

    await expect(
      loans.createRepayment(loan.id, {
        amountPaise: 20_001,
        accountId: account.id,
        occurredAt: '2025-02-03',
      }),
    ).rejects.toThrow('cannot exceed');
    expect(await database.loanEntries.where('loanId').equals(loan.id).count()).toBe(2);

    await loans.createRepayment(loan.id, {
      amountPaise: 20_000,
      accountId: account.id,
      occurredAt: '2025-02-04',
    });
    const details = await loans.getDetails(loan.id);
    expect(details?.summary).toMatchObject({
      principalPaise: 30_000,
      repaidPaise: 30_000,
      outstandingPaise: 0,
      status: 'settled',
    });
    expect(details?.history).toHaveLength(3);
    expect(await balances.getBalance(account.id)).toBe(100_000);
    await expect(
      loans.createRepayment(loan.id, {
        amountPaise: 1,
        accountId: account.id,
        occurredAt: '2025-02-05',
      }),
    ).rejects.toThrow('already settled');
  });

  it('applies borrowed repayments as account outflows without recording expenses', async () => {
    const person = await loans.createPerson({ name: 'Morgan' });
    const loan = await loans.createLoan(loanInput(person.id, account.id, 'borrowed', 40_000));
    await loans.createRepayment(loan.id, {
      amountPaise: 15_000,
      accountId: account.id,
      occurredAt: '2025-02-03',
    });

    expect(await balances.getBalance(account.id)).toBe(125_000);
    expect(await database.transactions.where('type').equals('loan-repayment-made').count()).toBe(1);
    expect(await database.ledgerEntries.where('transactionId').equals(
      (await database.transactions.where('type').equals('loan-repayment-made').first())?.id ?? '',
    ).first()).toMatchObject({ amountPaise: -15_000 });
    expect(await database.transactions.where('type').equals('expense').count()).toBe(0);
    expect((await loans.getLoan(loan.id))?.outstandingPaise).toBe(25_000);
  });

  it('edits an unpaid loan atomically and prevents changing principal after repayment', async () => {
    const person = await loans.createPerson({ name: 'Casey' });
    const secondPerson = await loans.createPerson({ name: 'Taylor' });
    const otherAccount = await accounts.createAccount(accountInput('Other account', 5_000));
    const loan = await loans.createLoan(loanInput(person.id, account.id, 'lent', 20_000));

    const edited = await loans.updateLoan(loan.id, {
      ...loanInput(secondPerson.id, otherAccount.id, 'borrowed', 25_000),
      description: 'Updated agreement',
    });
    expect(edited.direction).toBe('borrowed');
    expect(await balances.getBalance(account.id)).toBe(100_000);
    expect(await balances.getBalance(otherAccount.id)).toBe(30_000);
    expect(await database.transactions.where('loanId').equals(loan.id).first()).toMatchObject({
      type: 'money-borrowed',
      amountPaise: 25_000,
      accountId: otherAccount.id,
      description: 'Updated agreement',
    });

    await loans.createRepayment(loan.id, {
      amountPaise: 5_000,
      accountId: account.id,
      occurredAt: '2025-02-03',
    });
    await expect(
      loans.updateLoan(loan.id, {
        ...loanInput(secondPerson.id, otherAccount.id, 'borrowed', 30_000),
        description: 'Principal changed',
      }),
    ).rejects.toThrow('cannot change after repayments');
    await loans.updateLoan(loan.id, {
      ...loanInput(secondPerson.id, otherAccount.id, 'borrowed', 25_000),
      description: 'Updated notes only',
      dueDate: '2025-12-31',
    });
    expect((await loans.getLoan(loan.id))?.outstandingPaise).toBe(20_000);
  });

  it('deletes only loans without repayments and protects loan history from generic transaction deletion', async () => {
    const person = await loans.createPerson({ name: 'Sam' });
    const deletable = await loans.createLoan(loanInput(person.id, account.id, 'lent', 5_000));
    const deletableTransaction = await database.transactions.where('loanId').equals(deletable.id).first();
    if (!deletableTransaction) throw new Error('Expected principal transaction.');
    await loans.deleteLoan(deletable.id);
    expect(await database.transactions.get(deletableTransaction.id)).toBeUndefined();
    expect(await database.loanEntries.where('loanId').equals(deletable.id).count()).toBe(0);
    expect(await database.ledgerEntries.where('transactionId').equals(deletableTransaction.id).count()).toBe(0);

    const protectedLoan = await loans.createLoan(loanInput(person.id, account.id, 'lent', 8_000));
    const principal = await database.transactions.where('loanId').equals(protectedLoan.id).first();
    if (!principal) throw new Error('Expected principal transaction.');
    await expect(transactions.delete(principal.id)).rejects.toThrow('managed from their loan record');
    await loans.createRepayment(protectedLoan.id, {
      amountPaise: 2_000,
      accountId: account.id,
      occurredAt: '2025-02-03',
    });
    await expect(loans.deleteLoan(protectedLoan.id)).rejects.toThrow('cannot be deleted');
    expect(await loans.getDetails(protectedLoan.id)).toBeDefined();
  });

  it('manages people, retains archived history, filters loans, and calculates overdue status', async () => {
    const person = await loans.createPerson({ name: 'Riley', phoneNumber: '12345' });
    const otherPerson = await loans.createPerson({ name: 'Avery' });
    const overdue = await loans.createLoan({
      ...loanInput(person.id, account.id, 'lent', 10_000),
      startedAt: '2020-01-01',
      dueDate: '2020-02-01',
    });
    await loans.createLoan({
      ...loanInput(person.id, account.id, 'borrowed', 4_000),
      startedAt: '2022-01-01',
      dueDate: '2030-01-01',
    });
    await loans.createLoan({
      ...loanInput(otherPerson.id, account.id, 'borrowed', 3_000),
      startedAt: '2025-01-02',
    });

    await loans.updatePerson(person.id, { name: 'Riley Smith', phoneNumber: '67890', notes: 'Friend' });
    await loans.archivePerson(person.id);
    await expect(loans.createLoan(loanInput(person.id, account.id, 'lent', 100))).rejects.toThrow('Archived people');

    const filtered = await loans.list({
      personId: person.id,
      direction: 'lent',
      status: 'overdue',
      fromDate: '2019-01-01',
      toDate: '2021-01-01',
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.loan.id).toBe(overdue.id);
    expect(filtered.items[0]?.person?.name).toBe('Riley Smith');
    expect((await loans.list({ personId: person.id, pageSize: 100 })).totalItems).toBe(2);
    expect((await loans.getDashboardSummary()).overdueCount).toBe(1);
    expect((await loans.listPeople('archived')).map(({ id }) => id)).toContain(person.id);
  });

  it('rejects archived accounts and dates before an account opens', async () => {
    const person = await loans.createPerson({ name: 'Drew' });
    const futureAccount = await accounts.createAccount(accountInput('Future account', 0, '2025-03-01'));
    await expect(
      loans.createLoan({
        ...loanInput(person.id, futureAccount.id, 'lent', 1_000),
        startedAt: '2025-02-28',
      }),
    ).rejects.toThrow('before the account opening date');

    await accounts.archiveAccount(futureAccount.id);
    await expect(
      loans.createLoan({
        ...loanInput(person.id, futureAccount.id, 'lent', 1_000),
        startedAt: '2025-03-01',
      }),
    ).rejects.toThrow('Archived accounts');
  });

  it('rolls back all loan and repayment records when an account-ledger write fails', async () => {
    const person = await loans.createPerson({ name: 'Robin' });
    const originalAdd = database.ledgerEntries.add.bind(database.ledgerEntries);
    vi.spyOn(database.ledgerEntries, 'add').mockImplementation(async (entry) => {
      await originalAdd(entry);
      throw new Error('Simulated ledger write failure.');
    });
    await expect(
      loans.createLoan(loanInput(person.id, account.id, 'lent', 12_000)),
    ).rejects.toThrow('Simulated ledger write failure');
    expect(await database.loans.count()).toBe(0);
    expect(await database.transactions.count()).toBe(0);
    expect(await database.loanEntries.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
    expect(await balances.getBalance(account.id)).toBe(100_000);

    vi.restoreAllMocks();
    const loan = await loans.createLoan(loanInput(person.id, account.id, 'lent', 12_000));
    const repaymentWrite = database.ledgerEntries.add.bind(database.ledgerEntries);
    vi.spyOn(database.ledgerEntries, 'add').mockImplementation(async (entry) => {
      await repaymentWrite(entry);
      throw new Error('Simulated repayment ledger failure.');
    });
    await expect(
      loans.createRepayment(loan.id, {
        amountPaise: 1_000,
        accountId: account.id,
        occurredAt: '2025-02-03',
      }),
    ).rejects.toThrow('Simulated repayment ledger failure');
    expect((await loans.getLoan(loan.id))?.outstandingPaise).toBe(12_000);
    expect(await database.loanEntries.where('loanId').equals(loan.id).count()).toBe(1);
    expect(await database.transactions.where('loanId').equals(loan.id).count()).toBe(1);
    expect(await balances.getBalance(account.id)).toBe(88_000);
  });

  it('persists loan and repayment history after reopening the local database', async () => {
    const person = await loans.createPerson({ name: 'Jamie' });
    const loan = await loans.createLoan(loanInput(person.id, account.id, 'borrowed', 11_111));
    await loans.createRepayment(loan.id, {
      amountPaise: 1_111,
      accountId: account.id,
      occurredAt: '2025-02-03',
    });
    await database.close();

    database = new MyMoneyDatabase(databaseName);
    await database.open();
    loans = new LoansService(database);
    balances = new AccountBalanceService(database);

    expect((await loans.getLoan(loan.id))?.outstandingPaise).toBe(10_000);
    expect((await loans.getDetails(loan.id))?.history).toHaveLength(2);
    expect(await balances.getBalance(account.id)).toBe(110_000);
  });

  it('upgrades legacy loan records without discarding history or inventing principal data', async () => {
    const name = `mymoney-legacy-loans-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      accounts: 'id, type, status, name, createdAt, archivedAt',
      transactions:
        'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
      ledgerEntries: 'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
      loans: 'id, direction, personName, createdAt, settledAt',
      loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
      categories: 'id, name, appliesTo, status',
      budgets: 'id, categoryId, period, startsOn, endsOn',
      savingsGoals: 'id, targetDate, linkedAccountId',
      settings: 'key',
    });
    await legacy.open();
    await legacy.table('accounts').add({
      id: 'legacy-account',
      name: 'Old account',
      status: 'active',
      openingBalancePaise: 50_000,
      openingDate: '2020-01-01',
    });
    await legacy.table('loans').add({
      id: 'legacy-loan',
      direction: 'lent',
      personName: 'Legacy person',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await legacy.table('loans').add({
      id: 'legacy-unverified',
      direction: 'borrowed',
      personName: 'Unverified person',
      createdAt: '2024-01-03T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
    });
    await legacy.table('transactions').add({
      id: 'legacy-principal',
      type: 'money-lent',
      amountPaise: 9_000,
      occurredAt: '2024-01-02T12:00:00.000Z',
      description: 'Legacy principal',
      accountId: 'legacy-account',
      loanId: 'legacy-loan',
      createdAt: '2024-01-02T12:00:00.000Z',
      updatedAt: '2024-01-02T12:00:00.000Z',
    });
    await legacy.table('loanEntries').add({
      id: 'legacy-loan-entry',
      loanId: 'legacy-loan',
      transactionId: 'legacy-principal',
      occurredAt: '2024-01-02T12:00:00.000Z',
      outstandingChangePaise: 9_000,
    });
    await legacy.table('ledgerEntries').add({
      id: 'legacy-ledger-entry',
      transactionId: 'legacy-principal',
      accountId: 'legacy-account',
      occurredAt: '2024-01-02T12:00:00.000Z',
      amountPaise: -9_000,
    });
    await legacy.close();

    const upgraded = new MyMoneyDatabase(name);
    await upgraded.open();
    const loan = await upgraded.loans.get('legacy-loan');
    const personId = loan && 'personId' in loan ? loan.personId : undefined;
    expect(loan).toMatchObject({
      personName: 'Legacy person',
      personId: expect.any(String),
      amountPaise: 9_000,
      accountId: 'legacy-account',
      startedAt: '2024-01-02',
    });
    expect(await upgraded.people.get(personId ?? '')).toMatchObject({ name: 'Legacy person' });
    expect(await upgraded.loanEntries.count()).toBe(1);
    const upgradedLoans = new LoansService(upgraded);
    expect(await upgradedLoans.getLoan('legacy-unverified')).toMatchObject({
      principalPaise: null,
      status: 'needs-review',
    });
    expect((await upgradedLoans.getDashboardSummary()).needsReviewCount).toBe(1);
    await upgraded.delete();
  });
});

function accountInput(name: string, openingBalancePaise = 0, openingDate = '2020-01-01') {
  return {
    name,
    type: 'savings-bank' as const,
    openingBalancePaise,
    openingDate,
  };
}

function loanInput(
  personId: string,
  accountId: string,
  direction: 'lent' | 'borrowed',
  amountPaise: number,
) {
  return {
    personId,
    accountId,
    direction,
    amountPaise,
    startedAt: '2025-02-01',
  };
}
