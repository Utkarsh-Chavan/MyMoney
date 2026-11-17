import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import { AccountBalanceService } from './account-balance.service';
import { AccountTransfersService } from './account-transfers.service';
import { AccountsService, type AccountInput } from './accounts.service';

describe('account management and ledger balances', () => {
  let database: MyMoneyDatabase;
  let accounts: AccountsService;
  let balances: AccountBalanceService;
  let transfers: AccountTransfersService;

  beforeEach(() => {
    database = new MyMoneyDatabase(`mymoney-test-${crypto.randomUUID()}`);
    accounts = new AccountsService(database);
    balances = new AccountBalanceService(database);
    transfers = new AccountTransfersService(database);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('creates and edits an account without losing its opening-balance calculation', async () => {
    const account = await accounts.createAccount(accountInput('Savings', 125_050));
    expect(await balances.getBalance(account.id)).toBe(125_050);

    const updated = await accounts.updateAccount(account.id, {
      ...accountInput('Primary savings', 125_050),
      institution: 'Example Bank',
    });

    expect(updated.name).toBe('Primary savings');
    expect(updated.institution).toBe('Example Bank');
    expect(await balances.getBalance(account.id)).toBe(125_050);
  });

  it('calculates independent balances for multiple accounts from ledger entries', async () => {
    const first = await accounts.createAccount(accountInput('First', 75_000));
    const second = await accounts.createAccount(accountInput('Second', 10_000));

    await transfers.createTransfer({
      fromAccountId: first.id,
      toAccountId: second.id,
      amountPaise: 12_345,
      occurredAt: '2025-02-01T12:00:00.000Z',
    });

    expect(await balances.getBalance(first.id)).toBe(62_655);
    expect(await balances.getBalance(second.id)).toBe(22_345);
    expect((await balances.getBalance(first.id)) + (await balances.getBalance(second.id))).toBe(85_000);
    expect((await database.transactions.toArray())[0]?.type).toBe('transfer');
  });

  it('filters account history and incoming/outgoing totals by date', async () => {
    const source = await accounts.createAccount(accountInput('Source', 10_000));
    const destination = await accounts.createAccount(accountInput('Destination'));
    await transfers.createTransfer({
      fromAccountId: source.id,
      toAccountId: destination.id,
      amountPaise: 1_000,
      occurredAt: '2025-01-15T12:00:00.000Z',
    });
    await transfers.createTransfer({
      fromAccountId: source.id,
      toAccountId: destination.id,
      amountPaise: 2_000,
      occurredAt: '2025-02-15T12:00:00.000Z',
    });

    const summary = await balances.getSummary(source.id, { fromDate: '2025-02-01', toDate: '2025-02-28' });
    const history = await balances.getHistory(source.id, { fromDate: '2025-02-01', toDate: '2025-02-28' });
    expect(summary.currentBalancePaise).toBe(7_000);
    expect(summary.totalOutgoingPaise).toBe(2_000);
    expect(history).toHaveLength(1);
    expect(history[0]?.transaction.amountPaise).toBe(2_000);
  });

  it('archives accounts but preserves history and disallows transfers from them', async () => {
    const account = await accounts.createAccount(accountInput('Archived source', 50_000));
    const destination = await accounts.createAccount(accountInput('Destination'));
    await transfers.createTransfer({
      fromAccountId: account.id,
      toAccountId: destination.id,
      amountPaise: 5_000,
      occurredAt: '2025-02-01T12:00:00.000Z',
    });

    const archived = await accounts.archiveAccount(account.id);
    expect(archived.status).toBe('archived');
    expect(await balances.getBalance(account.id)).toBe(45_000);
    await expect(
      transfers.createTransfer({
        fromAccountId: account.id,
        toAccountId: destination.id,
        amountPaise: 500,
        occurredAt: '2025-02-02T12:00:00.000Z',
      }),
    ).rejects.toThrow('Archived accounts');
  });

  it('rejects invalid accounts and prevents deletion after ledger activity', async () => {
    await expect(accounts.createAccount(accountInput('   '))).rejects.toThrow('cannot be empty');
    const account = await accounts.createAccount(accountInput('Protected', 20_000));
    const destination = await accounts.createAccount(accountInput('Destination'));
    await transfers.createTransfer({
      fromAccountId: account.id,
      toAccountId: destination.id,
      amountPaise: 100,
      occurredAt: '2025-02-01T12:00:00.000Z',
    });
    await expect(accounts.deleteAccount(account.id)).rejects.toThrow('cannot be deleted');
    await expect(
      accounts.updateAccount(account.id, accountInput('Protected', 30_000)),
    ).rejects.toThrow('cannot be changed');
  });

  it('rejects overdrawn and same-account transfers without writing records', async () => {
    const source = await accounts.createAccount(accountInput('Source', 2_000));
    const destination = await accounts.createAccount(accountInput('Destination'));
    const input = {
      fromAccountId: source.id,
      toAccountId: destination.id,
      amountPaise: 2_001,
      occurredAt: '2025-02-01T12:00:00.000Z',
    };

    await expect(transfers.createTransfer(input)).rejects.toThrow('exceeds the available balance');
    await expect(
      transfers.createTransfer({ ...input, toAccountId: source.id, amountPaise: 1 }),
    ).rejects.toThrow('must be different');
    expect(await database.transactions.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
  });

  it('allows overdrafts only after the local negative-balance preference is enabled', async () => {
    const source = await accounts.createAccount(accountInput('Source', 100));
    const destination = await accounts.createAccount(accountInput('Destination'));
    const input = {
      fromAccountId: source.id,
      toAccountId: destination.id,
      amountPaise: 200,
      occurredAt: '2025-02-01T12:00:00.000Z',
    };

    await expect(transfers.createTransfer(input)).rejects.toThrow('exceeds the available balance');
    await transfers.setAllowNegativeBalances(true);
    await transfers.createTransfer(input);

    expect(await transfers.getAllowNegativeBalances()).toBe(true);
    expect(await balances.getBalance(source.id)).toBe(-100);
    expect(await balances.getBalance(destination.id)).toBe(200);
  });

  it('rejects transfers that would exceed safe integer balance precision', async () => {
    const source = await accounts.createAccount(accountInput('Source', 1_000));
    const destination = await accounts.createAccount(
      accountInput('At safe limit', Number.MAX_SAFE_INTEGER),
    );

    await expect(
      transfers.createTransfer({
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountPaise: 1,
        occurredAt: '2025-02-01T12:00:00.000Z',
      }),
    ).rejects.toThrow('safe account balance precision');
    expect(await database.transactions.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
  });

  it('rolls back the transaction and first ledger entry if writing the second entry fails', async () => {
    const source = await accounts.createAccount(accountInput('Source', 30_000));
    const destination = await accounts.createAccount(accountInput('Destination'));
    vi.spyOn(database.ledgerEntries, 'bulkAdd').mockImplementation(async (entries) => {
      await database.ledgerEntries.add(entries[0]);
      throw new Error('Simulated second-entry failure.');
    });

    await expect(
      transfers.createTransfer({
        fromAccountId: source.id,
        toAccountId: destination.id,
        amountPaise: 5_000,
        occurredAt: '2025-02-01T12:00:00.000Z',
      }),
    ).rejects.toThrow('Simulated second-entry failure');

    expect(await database.transactions.count()).toBe(0);
    expect(await database.ledgerEntries.count()).toBe(0);
    expect(await balances.getBalance(source.id)).toBe(30_000);
    expect(await balances.getBalance(destination.id)).toBe(0);
  });

  it('persists account and balance data when the database is reopened', async () => {
    const account = await accounts.createAccount(accountInput('Persistent', 7_654));
    database.close();
    database = new MyMoneyDatabase(database.name);
    accounts = new AccountsService(database);
    balances = new AccountBalanceService(database);

    expect((await accounts.getAccount(account.id))?.name).toBe('Persistent');
    expect(await balances.getBalance(account.id)).toBe(7_654);
  });

  it('migrates existing account records to the expanded account schema', async () => {
    const name = `mymoney-migration-${crypto.randomUUID()}`;
    const previousVersion = new Dexie(name);
    previousVersion.version(1).stores({ accounts: 'id, type, name, createdAt, archivedAt' });
    const createdAt = '2024-01-02T03:04:05.000Z';
    await previousVersion.table('accounts').add({
      id: 'legacy-account',
      name: 'Old cash',
      type: 'cash',
      currency: 'INR',
      openingBalancePaise: 125,
      createdAt,
      updatedAt: createdAt,
    });
    previousVersion.close();

    const migrated = new MyMoneyDatabase(name);
    const account = await migrated.accounts.get('legacy-account');
    expect(account?.type).toBe('cash-wallet');
    expect(account?.status).toBe('active');
    expect(account?.openingDate).toBe('2024-01-02');
    await migrated.delete();
  });
});

function accountInput(name: string, openingBalancePaise = 0): AccountInput {
  return {
    name,
    type: 'savings-bank',
    openingBalancePaise,
    openingDate: '2025-01-01',
  };
}
