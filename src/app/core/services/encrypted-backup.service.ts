import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import { APPLICATION_LOCK_SETTING_KEY } from '../security/security.constants';
import {
  BackupCryptoService,
  BACKUP_FORMAT_VERSION,
  type EncryptedBackupEnvelope,
} from './backup-crypto.service';

const BACKUP_TABLE_NAMES = [
  'accounts',
  'transactions',
  'ledgerEntries',
  'loans',
  'loanEntries',
  'people',
  'categories',
  'budgets',
  'budgetAlerts',
  'savingsGoals',
  'savingsGoalEntries',
  'settings',
] as const;

type BackupTableName = typeof BACKUP_TABLE_NAMES[number];
type BackupRecord = Record<string, unknown>;

export type BackupTheme = 'light' | 'dark';

interface BackupPayload {
  payloadVersion: typeof BACKUP_FORMAT_VERSION;
  theme: BackupTheme;
  tables: Record<BackupTableName, BackupRecord[]>;
}

export interface PreparedBackupRestore {
  createdAt: string;
  theme: BackupTheme;
  recordCounts: Record<BackupTableName, number>;
  payload: BackupPayload;
}

@Injectable({ providedIn: 'root' })
export class EncryptedBackupService {
  constructor(
    @Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase,
    private readonly cryptoService: BackupCryptoService,
  ) {}

  async exportEncryptedBackup(passphrase: string, theme: BackupTheme = 'light'): Promise<string> {
    this.assertSupportedDatabase();
    const tables = await this.database.transaction('r', this.database.tables, async () => {
      const snapshot = {} as Record<BackupTableName, BackupRecord[]>;
      for (const name of BACKUP_TABLE_NAMES) {
        const rows = await this.database.table(name).toArray() as BackupRecord[];
        snapshot[name] = name === 'settings'
          ? rows.filter(({ key }) => key !== APPLICATION_LOCK_SETTING_KEY)
          : rows;
      }
      return snapshot;
    });
    const payload: BackupPayload = { payloadVersion: BACKUP_FORMAT_VERSION, theme, tables };
    const plaintext = JSON.stringify(payload);
    return this.cryptoService.encryptBackup(plaintext, passphrase, this.database.verno);
  }

  async prepareRestore(serializedBackup: string, passphrase: string): Promise<PreparedBackupRestore> {
    this.assertSupportedDatabase();
    const plaintext = await this.cryptoService.decryptBackup(
      serializedBackup,
      passphrase,
      this.database.verno,
    );
    let value: unknown;
    try {
      value = JSON.parse(plaintext);
    } catch {
      throw new Error('The decrypted backup contents are not valid JSON.');
    }

    const payload = validatePayload(value, BACKUP_TABLE_NAMES);
    const recordCounts = {} as Record<BackupTableName, number>;
    for (const name of BACKUP_TABLE_NAMES) recordCounts[name] = payload.tables[name].length;
    const envelope = JSON.parse(serializedBackup) as EncryptedBackupEnvelope;
    return { createdAt: envelope.createdAt, theme: payload.theme, recordCounts, payload };
  }

  async restorePreparedBackup(prepared: PreparedBackupRestore): Promise<void> {
    this.assertSupportedDatabase();
    const payload = validatePayload(prepared.payload, BACKUP_TABLE_NAMES);
    const transactionTables = this.database.tables;

    await this.database.transaction('rw', transactionTables, async () => {
      const deviceLockSetting = await this.database.settings.get(APPLICATION_LOCK_SETTING_KEY);
      for (const table of transactionTables) await table.clear();
      for (const name of BACKUP_TABLE_NAMES) {
        const records = name === 'settings' && deviceLockSetting
          ? [...payload.tables[name], deviceLockSetting]
          : payload.tables[name];
        if (records.length) await this.database.table(name).bulkAdd(records);
      }
    });
  }

  private assertSupportedDatabase(): void {
    if (this.database.verno !== 6) {
      throw new Error(`Encrypted backup currently supports database schema version 6, not ${this.database.verno}.`);
    }
    const actual = this.database.tables.map(({ name }) => name).sort();
    const expected = [...BACKUP_TABLE_NAMES].sort();
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      throw new Error('The current database table layout is not supported by this backup version.');
    }
  }
}

function validatePayload(value: unknown, tableNames: readonly BackupTableName[]): BackupPayload {
  if (!isRecord(value) || value['payloadVersion'] !== BACKUP_FORMAT_VERSION || !isRecord(value['tables'])) {
    throw new Error('Backup payload version or structure is invalid.');
  }
  const theme = value['theme'] ?? 'light';
  if (theme !== 'light' && theme !== 'dark') {
    throw new Error('Backup contains an invalid theme preference.');
  }
  const rawTables = value['tables'];
  const actualNames = Object.keys(rawTables).sort();
  const expectedNames = [...tableNames].sort();
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error('Backup is missing required tables or contains unsupported tables.');
  }

  const tables = {} as Record<BackupTableName, BackupRecord[]>;
  const ids = {} as Record<BackupTableName, Set<string>>;
  for (const name of tableNames) {
    const rows = rawTables[name];
    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      throw new Error(`Backup table "${name}" is missing or malformed.`);
    }
    tables[name] = rows;
    const seen = new Set<string>();
    for (const row of rows) {
      const key = name === 'settings' ? row['key'] : row['id'];
      if (typeof key !== 'string' || !key || seen.has(key)) {
        throw new Error(`Backup table "${name}" contains a missing or duplicate key.`);
      }
      seen.add(key);
    }
    ids[name] = seen;
  }

  validateRows(tables, ids);
  return { payloadVersion: BACKUP_FORMAT_VERSION, theme, tables };
}

function validateRows(
  tables: Record<BackupTableName, BackupRecord[]>,
  ids: Record<BackupTableName, Set<string>>,
): void {
  for (const row of tables.accounts) {
    requireString(row, 'name', 'accounts');
    requireEnum(row, 'type', ['savings-bank', 'current-bank', 'cash-wallet', 'digital-wallet', 'other'], 'accounts');
    requireEnum(row, 'status', ['active', 'archived'], 'accounts');
    requireEnum(row, 'currency', ['INR'], 'accounts');
    requireMoney(row, 'openingBalancePaise', 'accounts', false, true);
    requireDate(row, 'openingDate', 'accounts');
    requireDate(row, 'createdAt', 'accounts');
    requireDate(row, 'updatedAt', 'accounts');
    requireOptionalDate(row, 'archivedAt', 'accounts');
  }

  const transactionTypes = [
    'income', 'expense', 'transfer', 'savings-contribution', 'savings-withdrawal',
    'money-lent', 'money-borrowed', 'loan-repayment-received', 'loan-repayment-made',
  ];
  for (const row of tables.transactions) {
    requireEnum(row, 'type', transactionTypes, 'transactions');
    requireMoney(row, 'amountPaise', 'transactions');
    requireDate(row, 'occurredAt', 'transactions');
    requireString(row, 'description', 'transactions');
    requireDate(row, 'createdAt', 'transactions');
    requireDate(row, 'updatedAt', 'transactions');
    requireOptionalReference(row, 'accountId', ids.accounts, 'transactions');
    requireOptionalReference(row, 'categoryId', ids.categories, 'transactions');
    requireOptionalReference(row, 'fromAccountId', ids.accounts, 'transactions');
    requireOptionalReference(row, 'toAccountId', ids.accounts, 'transactions');
    requireOptionalReference(row, 'loanId', ids.loans, 'transactions');
    requireOptionalReference(row, 'savingsGoalId', ids.savingsGoals, 'transactions');
    if (row['tags'] !== undefined && (!Array.isArray(row['tags']) || !row['tags'].every((tag) => typeof tag === 'string'))) {
      throw new Error('Backup transactions contain invalid tags.');
    }
  }

  for (const row of tables.ledgerEntries) {
    requireString(row, 'transactionId', 'ledgerEntries');
    requireString(row, 'accountId', 'ledgerEntries');
    requireDate(row, 'occurredAt', 'ledgerEntries');
    requireMoney(row, 'amountPaise', 'ledgerEntries', true, true);
    requireReference(row, 'transactionId', ids.transactions, 'ledgerEntries');
    requireReference(row, 'accountId', ids.accounts, 'ledgerEntries');
  }

  for (const row of tables.loans) {
    requireEnum(row, 'direction', ['lent', 'borrowed'], 'loans');
    requireDate(row, 'createdAt', 'loans');
    requireDate(row, 'updatedAt', 'loans');
    requireOptionalReference(row, 'personId', ids.people, 'loans');
    requireOptionalReference(row, 'accountId', ids.accounts, 'loans');
    requireOptionalDate(row, 'startedAt', 'loans');
    requireOptionalDate(row, 'dueDate', 'loans');
    requireOptionalDate(row, 'settledAt', 'loans');
    if (row['amountPaise'] !== undefined) requireMoney(row, 'amountPaise', 'loans');
  }

  for (const row of tables.loanEntries) {
    requireString(row, 'transactionId', 'loanEntries');
    requireString(row, 'loanId', 'loanEntries');
    requireDate(row, 'occurredAt', 'loanEntries');
    requireMoney(row, 'outstandingChangePaise', 'loanEntries', true, true);
    requireReference(row, 'transactionId', ids.transactions, 'loanEntries');
    requireReference(row, 'loanId', ids.loans, 'loanEntries');
  }

  for (const row of tables.people) {
    requireString(row, 'name', 'people');
    requireEnum(row, 'status', ['active', 'archived'], 'people');
    requireDate(row, 'createdAt', 'people');
    requireDate(row, 'updatedAt', 'people');
    requireOptionalDate(row, 'archivedAt', 'people');
  }

  for (const row of tables.categories) {
    requireString(row, 'name', 'categories');
    requireEnum(row, 'appliesTo', ['income', 'expense'], 'categories');
    requireEnum(row, 'status', ['active', 'archived'], 'categories');
    if (typeof row['isDefault'] !== 'boolean') throw new Error('Backup categories contain an invalid default flag.');
    requireDate(row, 'createdAt', 'categories');
  }

  for (const row of tables.budgets) {
    requireString(row, 'name', 'budgets');
    requireMoney(row, 'amountPaise', 'budgets');
    requireEnum(row, 'period', ['weekly', 'monthly', 'custom', 'yearly'], 'budgets');
    requireDate(row, 'startsOn', 'budgets');
    requireOptionalDate(row, 'endsOn', 'budgets');
    requireOptionalReference(row, 'categoryId', ids.categories, 'budgets');
    requireOptionalDate(row, 'archivedAt', 'budgets');
  }

  for (const row of tables.budgetAlerts) {
    requireReference(row, 'budgetId', ids.budgets, 'budgetAlerts');
    requireDate(row, 'periodStart', 'budgetAlerts');
    requireEnum(row, 'thresholdPercent', [50, 75, 90, 100], 'budgetAlerts');
    requireMoney(row, 'spentPaise', 'budgetAlerts', false, true);
    requireMoney(row, 'budgetAmountPaise', 'budgetAlerts');
    requireDate(row, 'createdAt', 'budgetAlerts');
  }

  for (const row of tables.savingsGoals) {
    requireString(row, 'name', 'savingsGoals');
    requireMoney(row, 'targetAmountPaise', 'savingsGoals');
    requireEnum(row, 'status', ['active', 'completed', 'archived'], 'savingsGoals');
    requireOptionalReference(row, 'linkedAccountId', ids.accounts, 'savingsGoals');
    requireOptionalDate(row, 'targetDate', 'savingsGoals');
    requireOptionalDate(row, 'archivedAt', 'savingsGoals');
    requireDate(row, 'createdAt', 'savingsGoals');
    requireDate(row, 'updatedAt', 'savingsGoals');
  }

  for (const row of tables.savingsGoalEntries) {
    requireReference(row, 'goalId', ids.savingsGoals, 'savingsGoalEntries');
    requireReference(row, 'transactionId', ids.transactions, 'savingsGoalEntries');
    requireReference(row, 'accountId', ids.accounts, 'savingsGoalEntries');
    requireDate(row, 'occurredAt', 'savingsGoalEntries');
    requireMoney(row, 'amountPaise', 'savingsGoalEntries', true, true);
  }

  for (const row of tables.settings) {
    requireString(row, 'key', 'settings');
    requireString(row, 'value', 'settings', true);
    requireDate(row, 'updatedAt', 'settings');
    if (row['key'] === APPLICATION_LOCK_SETTING_KEY) {
      throw new Error('Backups must not contain device-specific application-lock credentials.');
    }
  }
}

function requireMoney(
  row: BackupRecord,
  field: string,
  table: string,
  allowNegative = false,
  allowZero = false,
): void {
  const amount = row[field];
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    (!allowNegative && amount < 0) ||
    (!allowZero && amount === 0)
  ) {
    throw new Error(`Backup table "${table}" contains an invalid ${field}.`);
  }
}

function requireString(row: BackupRecord, field: string, table: string, allowEmpty = false): void {
  const value = row[field];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`Backup table "${table}" contains an invalid ${field}.`);
  }
}

function requireDate(row: BackupRecord, field: string, table: string): void {
  const value = row[field];
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Backup table "${table}" contains an invalid ${field}.`);
  }
}

function requireOptionalDate(row: BackupRecord, field: string, table: string): void {
  if (row[field] !== undefined) requireDate(row, field, table);
}

function requireEnum(
  row: BackupRecord,
  field: string,
  allowed: readonly unknown[],
  table: string,
): void {
  if (!allowed.includes(row[field])) {
    throw new Error(`Backup table "${table}" contains an unsupported ${field}.`);
  }
}

function requireReference(
  row: BackupRecord,
  field: string,
  keys: Set<string>,
  table: string,
): void {
  const key = row[field];
  if (typeof key !== 'string' || !keys.has(key)) {
    throw new Error(`Backup table "${table}" contains a broken ${field} relationship.`);
  }
}

function requireOptionalReference(
  row: BackupRecord,
  field: string,
  keys: Set<string>,
  table: string,
): void {
  if (row[field] !== undefined) requireReference(row, field, keys, table);
}

function isRecord(value: unknown): value is BackupRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
