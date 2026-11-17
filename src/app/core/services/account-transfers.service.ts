import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type { LedgerEntry, Transaction } from '../models/finance.models';

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  occurredAt: string;
  description?: string;
}

const ALLOW_NEGATIVE_SETTING = 'accounts.allowNegativeBalances';

@Injectable({ providedIn: 'root' })
export class AccountTransfersService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async getAllowNegativeBalances(): Promise<boolean> {
    const setting = await this.database.settings.get(ALLOW_NEGATIVE_SETTING);
    return setting?.value === 'true';
  }

  async setAllowNegativeBalances(allow: boolean): Promise<void> {
    await this.database.settings.put({
      key: ALLOW_NEGATIVE_SETTING,
      value: String(allow),
      updatedAt: new Date().toISOString(),
    });
  }

  async createTransfer(input: CreateTransferInput): Promise<Transaction> {
    this.validateInput(input);
    const transactionId = crypto.randomUUID();
    const transaction: Transaction = {
      id: transactionId,
      type: 'transfer',
      amountPaise: input.amountPaise,
      occurredAt: input.occurredAt,
      description: input.description?.trim() || 'Account transfer',
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const entries: [LedgerEntry, LedgerEntry] = [
      {
        id: crypto.randomUUID(),
        transactionId,
        accountId: input.fromAccountId,
        occurredAt: input.occurredAt,
        amountPaise: -input.amountPaise,
      },
      {
        id: crypto.randomUUID(),
        transactionId,
        accountId: input.toAccountId,
        occurredAt: input.occurredAt,
        amountPaise: input.amountPaise,
      },
    ];

    await this.database.transaction(
      'rw',
      this.database.accounts,
      this.database.transactions,
      this.database.ledgerEntries,
      this.database.settings,
      async () => {
        const [source, destination, setting] = await Promise.all([
          this.database.accounts.get(input.fromAccountId),
          this.database.accounts.get(input.toAccountId),
          this.database.settings.get(ALLOW_NEGATIVE_SETTING),
        ]);

        if (!source || !destination) throw new Error('Select two existing accounts.');
        if (source.status !== 'active' || destination.status !== 'active') {
          throw new Error('Archived accounts cannot be used for new transfers.');
        }
        if (input.occurredAt.slice(0, 10) < source.openingDate || input.occurredAt.slice(0, 10) < destination.openingDate) {
          throw new Error('Transfer date cannot be before either account’s opening date.');
        }

        const [sourceEntries, destinationEntries] = await Promise.all([
          this.database.ledgerEntries.where('accountId').equals(source.id).toArray(),
          this.database.ledgerEntries.where('accountId').equals(destination.id).toArray(),
        ]);
        const sourceBalance = this.calculateBalance(source.openingBalancePaise, sourceEntries);
        const destinationBalance = this.calculateBalance(destination.openingBalancePaise, destinationEntries);
        if (!Number.isSafeInteger(sourceBalance - input.amountPaise)) {
          throw new RangeError('Transfer would exceed safe account balance precision.');
        }
        if (!Number.isSafeInteger(destinationBalance + input.amountPaise)) {
          throw new RangeError('Transfer would exceed safe account balance precision.');
        }
        if (setting?.value !== 'true' && input.amountPaise > sourceBalance) {
          throw new Error('Transfer amount exceeds the available balance.');
        }

        await this.database.transactions.add(transaction);
        await this.database.ledgerEntries.bulkAdd(entries);
      },
    );

    return transaction;
  }

  private validateInput(input: CreateTransferInput): void {
    if (!input.fromAccountId || !input.toAccountId) throw new Error('Choose a source and destination account.');
    if (input.fromAccountId === input.toAccountId) throw new Error('Source and destination accounts must be different.');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error('Transfer amount must be a positive amount in paise.');
    }
    if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('Enter a valid transfer date.');
  }

  private calculateBalance(openingBalancePaise: number, entries: LedgerEntry[]): number {
    if (!Number.isSafeInteger(openingBalancePaise)) throw new Error('Invalid opening balance.');
    return entries.reduce((balance, entry) => {
      if (!Number.isSafeInteger(entry.amountPaise)) throw new Error('Invalid ledger entry amount.');
      const nextBalance = balance + entry.amountPaise;
      if (!Number.isSafeInteger(nextBalance)) {
        throw new RangeError('Account balance exceeds safe integer precision.');
      }
      return nextBalance;
    }, openingBalancePaise);
  }
}
