import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import { AccountBalanceService } from './account-balance.service';
import { AccountTransfersService } from './account-transfers.service';
import { AccountsService } from './accounts.service';
import { BackupCryptoService } from './backup-crypto.service';
import { BudgetsService } from './budgets.service';
import { CategoriesService } from './categories.service';
import { EncryptedBackupService, type PreparedBackupRestore } from './encrypted-backup.service';
import { LoansService } from './loans.service';
import { SavingsGoalsService } from './savings-goals.service';
import { TransactionsService } from './transactions.service';

const passphrase = 'a-test-backup-passphrase';

describe('EncryptedBackupService', () => {
  let sourceDatabase: MyMoneyDatabase;
  let targetDatabase: MyMoneyDatabase | undefined;
  let sourceBackup: EncryptedBackupService;
  let cryptoService: BackupCryptoService;
  let sourceAccountId: string;
  let sourceTransactionIds: string[];
  let sourceBalancePaise: number;
  let prepared: PreparedBackupRestore;

  beforeEach(async () => {
    sourceDatabase = new MyMoneyDatabase(`mymoney-backup-source-${crypto.randomUUID()}`);
    cryptoService = new BackupCryptoService();
    sourceBackup = new EncryptedBackupService(sourceDatabase, cryptoService);

    const accounts = new AccountsService(sourceDatabase);
    const categories = new CategoriesService(sourceDatabase);
    const transactions = new TransactionsService(sourceDatabase, categories);
    const loans = new LoansService(sourceDatabase);
    const budgets = new BudgetsService(sourceDatabase);
    const savings = new SavingsGoalsService(sourceDatabase);
    const accountTransfers = new AccountTransfersService(sourceDatabase);
    const accountBalances = new AccountBalanceService(sourceDatabase);

    const account = await accounts.createAccount({
      name: 'Backup source account',
      type: 'savings-bank',
      openingBalancePaise: 1_000_000,
      openingDate: '2020-01-01',
    });
    sourceAccountId = account.id;
    await categories.ensureDefaults();
    const categoryList = await categories.list();
    const incomeCategoryId = categoryList.find(({ appliesTo }) => appliesTo === 'income')!.id;
    const expenseCategoryId = categoryList.find(({ appliesTo }) => appliesTo === 'expense')!.id;

    await transactions.create({
      type: 'income',
      amountPaise: 500_000,
      accountId: account.id,
      categoryId: incomeCategoryId,
      occurredAt: '2025-01-10',
      description: 'Backup-test income',
    });
    await transactions.create({
      type: 'expense',
      amountPaise: 20_000,
      accountId: account.id,
      categoryId: expenseCategoryId,
      occurredAt: '2025-01-12',
      description: 'Backup-test expense',
    });

    const person = await loans.createPerson({ name: 'Backup test person' });
    const loan = await loans.createLoan({
      direction: 'lent',
      personId: person.id,
      amountPaise: 100_000,
      accountId: account.id,
      startedAt: '2025-01-13',
      description: 'Backup-test loan',
    });
    await loans.createRepayment(loan.id, {
      amountPaise: 20_000,
      accountId: account.id,
      occurredAt: '2025-01-14',
      notes: 'Partial repayment',
    });
    const budget = await budgets.create({
      name: 'Backup-test budget',
      categoryId: expenseCategoryId,
      amountPaise: 10_000,
      period: 'monthly',
      startsOn: '2025-01-01',
    });
    await budgets.list('2025-01-31');

    const goal = await savings.create({
      name: 'Backup-test goal',
      targetAmountPaise: 100_000,
      linkedAccountId: account.id,
    });
    await savings.contribute(goal.id, {
      amountPaise: 50_000,
      accountId: account.id,
      occurredAt: '2025-01-15',
    });
    await savings.withdraw(goal.id, {
      amountPaise: 10_000,
      accountId: account.id,
      occurredAt: '2025-01-16',
    });
    await accountTransfers.setAllowNegativeBalances(true);

    sourceTransactionIds = (await sourceDatabase.transactions.toArray()).map(({ id }) => id);
    expect(await sourceDatabase.budgets.get(budget.id)).toBeDefined();
    sourceBalancePaise = await accountBalances.getBalance(account.id);
    prepared = await sourceBackup.prepareRestore(
      await sourceBackup.exportEncryptedBackup(passphrase),
      passphrase,
    );
  });

  afterEach(async () => {
    await sourceDatabase.delete();
    if (targetDatabase) await targetDatabase.delete();
  });

  it('exports every schema table encrypted and preserves record relationships on restore', async () => {
    const encryptedFile = await sourceBackup.exportEncryptedBackup(passphrase, 'dark');
    expect(encryptedFile).not.toContain('Backup-test income');
    expect(encryptedFile).not.toContain(sourceAccountId);

    const envelope = JSON.parse(encryptedFile);
    expect(envelope).toMatchObject({
      format: 'mymoney-encrypted-backup',
      formatVersion: 1,
      schemaVersion: 6,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 },
      cipher: { name: 'AES-GCM', tagLength: 128 },
    });
    const decoded = JSON.parse(await cryptoService.decryptBackup(encryptedFile, passphrase, 6));
    expect(decoded.theme).toBe('dark');
    expect(Object.keys(decoded.tables).sort()).toEqual([
      'accounts', 'budgetAlerts', 'budgets', 'categories', 'ledgerEntries',
      'loanEntries', 'loans', 'people', 'savingsGoalEntries', 'savingsGoals',
      'settings', 'transactions',
    ]);

    targetDatabase = new MyMoneyDatabase(`mymoney-backup-target-${crypto.randomUUID()}`);
    const targetAccounts = new AccountsService(targetDatabase);
    const oldTargetAccount = await targetAccounts.createAccount({
      name: 'Target account to replace',
      type: 'cash-wallet',
      openingBalancePaise: 5_000,
      openingDate: '2020-01-01',
    });
    await new AccountTransfersService(targetDatabase).setAllowNegativeBalances(false);
    const targetBackup = new EncryptedBackupService(targetDatabase, cryptoService);
    const restorePreview = await targetBackup.prepareRestore(encryptedFile, passphrase);
    expect(restorePreview.theme).toBe('dark');

    await targetBackup.restorePreparedBackup(restorePreview);

    expect(await targetDatabase.accounts.get(oldTargetAccount.id)).toBeUndefined();
    expect(await targetDatabase.accounts.get(sourceAccountId)).toMatchObject({ name: 'Backup source account' });
    expect(await new AccountBalanceService(targetDatabase).getBalance(sourceAccountId)).toBe(sourceBalancePaise);
    expect((await targetDatabase.transactions.toArray()).map(({ id }) => id).sort())
      .toEqual(sourceTransactionIds.sort());
    expect(await targetDatabase.ledgerEntries.count()).toBe(await sourceDatabase.ledgerEntries.count());
    expect(await targetDatabase.loanEntries.count()).toBe(await sourceDatabase.loanEntries.count());
    expect(await targetDatabase.savingsGoalEntries.count()).toBe(await sourceDatabase.savingsGoalEntries.count());
    expect(await targetDatabase.budgetAlerts.count()).toBe(await sourceDatabase.budgetAlerts.count());
    expect((await targetDatabase.settings.get('accounts.allowNegativeBalances'))?.value).toBe('true');
  });

  it('preserves the current device lock configuration rather than restoring another device credential', async () => {
    targetDatabase = new MyMoneyDatabase(`mymoney-backup-lock-${crypto.randomUUID()}`);
    const localLockConfiguration = await cryptoService.createLockConfiguration('a-local-device-lock');
    const settings = targetDatabase.settings;
    await settings.put({
      key: 'security.applicationLock.v1',
      value: JSON.stringify(localLockConfiguration),
      updatedAt: new Date().toISOString(),
    });
    const targetBackup = new EncryptedBackupService(targetDatabase, cryptoService);
    const restorePreview = await targetBackup.prepareRestore(
      await sourceBackup.exportEncryptedBackup(passphrase),
      passphrase,
    );

    await targetBackup.restorePreparedBackup(restorePreview);

    expect(await settings.get('security.applicationLock.v1')?.then((setting) => JSON.parse(setting.value)))
      .toEqual(localLockConfiguration);
  });

  it('rejects missing tables and broken record relationships before changing the database', async () => {
    const malformed = await cryptoService.encryptBackup(
      JSON.stringify({ payloadVersion: 1, tables: {} }),
      passphrase,
      6,
    );
    await expect(sourceBackup.prepareRestore(malformed, passphrase))
      .rejects.toThrow('missing required tables');

    const exported = await sourceBackup.exportEncryptedBackup(passphrase);
    const contents = JSON.parse(await cryptoService.decryptBackup(exported, passphrase, 6));
    contents.tables.ledgerEntries[0].accountId = 'missing-account';
    const invalidReference = await cryptoService.encryptBackup(JSON.stringify(contents), passphrase, 6);
    await expect(sourceBackup.prepareRestore(invalidReference, passphrase))
      .rejects.toThrow('broken accountId relationship');
    expect(await sourceDatabase.accounts.count()).toBe(1);
  });

  it('rolls back a failed multi-table replacement and leaves original records intact', async () => {
    const sourceAccounts = new AccountsService(sourceDatabase);
    await sourceAccounts.createAccount({
      name: 'Reject during restore',
      type: 'other',
      openingBalancePaise: 1_000,
      openingDate: '2020-01-01',
    });
    const encryptedFile = await sourceBackup.exportEncryptedBackup(passphrase);
    const restorePreview = await sourceBackup.prepareRestore(encryptedFile, passphrase);

    targetDatabase = new MyMoneyDatabase(`mymoney-backup-rollback-${crypto.randomUUID()}`);
    const targetAccounts = new AccountsService(targetDatabase);
    const original = await targetAccounts.createAccount({
      name: 'Must survive rollback',
      type: 'cash-wallet',
      openingBalancePaise: 77_000,
      openingDate: '2020-01-01',
    });
    targetDatabase.accounts.hook('creating', (_key, account) => {
      if (account.name === 'Reject during restore') throw new Error('Injected restore write failure.');
    });

    const targetBackup = new EncryptedBackupService(targetDatabase, cryptoService);
    await expect(targetBackup.restorePreparedBackup(restorePreview)).rejects.toThrow('Injected restore write failure');
    expect(await targetDatabase.accounts.toArray()).toEqual([original]);
    expect(await targetDatabase.transactions.count()).toBe(0);
    expect(await targetDatabase.ledgerEntries.count()).toBe(0);
  });
});
