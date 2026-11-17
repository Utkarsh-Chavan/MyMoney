import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type { Account, LedgerEntry, Transaction } from '../models/finance.models';

export interface AccountHistoryItem {
  entry: LedgerEntry;
  transaction: Transaction;
}

export interface AccountDateFilter {
  fromDate?: string;
  toDate?: string;
}

export interface AccountBalanceSummary {
  account: Account;
  currentBalancePaise: number;
  totalIncomingPaise: number;
  totalOutgoingPaise: number;
}

@Injectable({ providedIn: 'root' })
export class AccountBalanceService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async getBalance(accountId: string): Promise<number> {
    const account = await this.requireAccount(accountId);
    const entries = await this.database.ledgerEntries.where('accountId').equals(accountId).toArray();
    return this.calculateBalance(account, entries);
  }

  async getSummary(accountId: string, filter: AccountDateFilter = {}): Promise<AccountBalanceSummary> {
    const account = await this.requireAccount(accountId);
    const entries = await this.database.ledgerEntries.where('accountId').equals(accountId).toArray();
    const currentBalancePaise = this.calculateBalance(account, entries);
    const filteredEntries = entries.filter((entry) => this.matchesDate(entry.occurredAt, filter));

    return {
      account,
      currentBalancePaise,
      totalIncomingPaise: filteredEntries.reduce(
        (total, entry) => entry.amountPaise > 0 ? this.addSafe(total, entry.amountPaise) : total,
        0,
      ),
      totalOutgoingPaise: filteredEntries.reduce(
        (total, entry) => entry.amountPaise < 0 ? this.addSafe(total, -entry.amountPaise) : total,
        0,
      ),
    };
  }

  async getHistory(accountId: string, filter: AccountDateFilter = {}): Promise<AccountHistoryItem[]> {
    const entries = await this.database.ledgerEntries.where('accountId').equals(accountId).toArray();
    const matchingEntries = entries.filter((entry) => this.matchesDate(entry.occurredAt, filter));
    const transactions = await this.database.transactions.bulkGet(
      matchingEntries.map((entry) => entry.transactionId),
    );

    return matchingEntries
      .map((entry, index) => {
        const transaction = transactions[index];
        if (!transaction) throw new Error(`Missing transaction for ledger entry ${entry.id}.`);
        return { entry, transaction };
      })
      .sort((left, right) => right.entry.occurredAt.localeCompare(left.entry.occurredAt));
  }

  private async requireAccount(accountId: string): Promise<Account> {
    const account = await this.database.accounts.get(accountId);
    if (!account) throw new Error('Account not found.');
    return account;
  }

  private calculateBalance(account: Account, entries: LedgerEntry[]): number {
    return entries.reduce(
      (balance, entry) => this.addSafe(balance, this.validateEntryAmount(entry.amountPaise)),
      this.validateEntryAmount(account.openingBalancePaise),
    );
  }

  private validateEntryAmount(amountPaise: number): number {
    if (!Number.isSafeInteger(amountPaise)) throw new Error('Invalid ledger entry amount.');
    return amountPaise;
  }

  private addSafe(left: number, right: number): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError('Account balance exceeds safe integer precision.');
    return result;
  }

  private matchesDate(occurredAt: string, filter: AccountDateFilter): boolean {
    const date = occurredAt.slice(0, 10);
    return (!filter.fromDate || date >= filter.fromDate) && (!filter.toDate || date <= filter.toDate);
  }
}
