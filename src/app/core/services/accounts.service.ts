import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type { Account, AccountStatus, AccountType } from '../models/finance.models';

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string;
  openingBalancePaise: number;
  openingDate: string;
}

const ACCOUNT_TYPES: readonly AccountType[] = [
  'savings-bank',
  'current-bank',
  'cash-wallet',
  'digital-wallet',
  'other',
];

@Injectable({ providedIn: 'root' })
export class AccountsService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async listAccounts(status?: AccountStatus): Promise<Account[]> {
    const accounts = status
      ? await this.database.accounts.where('status').equals(status).toArray()
      : await this.database.accounts.toArray();
    return accounts.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getAccount(id: string): Promise<Account | undefined> {
    return this.database.accounts.get(id);
  }

  async hasLedgerHistory(id: string): Promise<boolean> {
    return (await this.database.ledgerEntries.where('accountId').equals(id).count()) > 0;
  }

  async createAccount(input: AccountInput): Promise<Account> {
    const normalized = this.validateInput(input);
    const now = new Date().toISOString();
    const account: Account = {
      ...normalized,
      id: crypto.randomUUID(),
      currency: 'INR',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.database.accounts.add(account);
    return account;
  }

  async updateAccount(id: string, input: AccountInput): Promise<Account> {
    const normalized = this.validateInput(input);

    return this.database.transaction('rw', this.database.accounts, this.database.ledgerEntries, async () => {
      const current = await this.database.accounts.get(id);
      if (!current) throw new Error('Account not found.');

      const history = await this.database.ledgerEntries.where('accountId').equals(id).count();
      if (
        history > 0 &&
        (current.openingBalancePaise !== normalized.openingBalancePaise ||
          current.openingDate !== normalized.openingDate)
      ) {
        throw new Error('Opening balance and opening date cannot be changed after account activity.');
      }

      const updated: Account = { ...current, ...normalized, updatedAt: new Date().toISOString() };
      await this.database.accounts.put(updated);
      return updated;
    });
  }

  async archiveAccount(id: string): Promise<Account> {
    const account = await this.database.accounts.get(id);
    if (!account) throw new Error('Account not found.');
    if (account.status === 'archived') return account;

    const now = new Date().toISOString();
    const archived: Account = { ...account, status: 'archived', archivedAt: now, updatedAt: now };
    await this.database.accounts.put(archived);
    return archived;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.accounts,
      this.database.transactions,
      this.database.ledgerEntries,
      async () => {
        const account = await this.database.accounts.get(id);
        if (!account) throw new Error('Account not found.');
        const [entryCount, sentCount, receivedCount, transactionCount] = await Promise.all([
          this.database.ledgerEntries.where('accountId').equals(id).count(),
          this.database.transactions.where('fromAccountId').equals(id).count(),
          this.database.transactions.where('toAccountId').equals(id).count(),
          this.database.transactions.where('accountId').equals(id).count(),
        ]);
        if (entryCount || sentCount || receivedCount || transactionCount) {
          throw new Error('Accounts with financial history cannot be deleted. Archive this account instead.');
        }
        await this.database.accounts.delete(id);
      },
    );
  }

  private validateInput(input: AccountInput): AccountInput {
    const name = input.name.trim();
    if (!name) throw new Error('Account name cannot be empty.');
    if (!ACCOUNT_TYPES.includes(input.type)) throw new Error('Choose a valid account type.');
    if (!Number.isSafeInteger(input.openingBalancePaise) || input.openingBalancePaise < 0) {
      throw new Error('Opening balance must be a non-negative amount in paise.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate)) {
      throw new Error('Enter a valid opening date.');
    }
    const parsedDate = new Date(`${input.openingDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.openingDate) {
      throw new Error('Enter a valid opening date.');
    }

    const institution = input.institution?.trim();
    return {
      ...input,
      name,
      institution: institution || undefined,
    };
  }
}
