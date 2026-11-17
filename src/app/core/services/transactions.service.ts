import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type {
  Account,
  Category,
  EntryTransactionType,
  LedgerEntry,
  PaymentMethod,
  Transaction,
  TransactionType,
} from '../models/finance.models';
import { CategoriesService } from './categories.service';

export interface TransactionInput {
  type: EntryTransactionType;
  amountPaise: number;
  accountId: string;
  categoryId: string;
  occurredAt: string;
  description?: string;
  notes?: string;
  tags?: string[];
  paymentMethod?: PaymentMethod;
}

export interface TransactionFilters {
  search?: string;
  accountId?: string;
  categoryId?: string;
  type?: TransactionType | 'all';
  fromDate?: string;
  toDate?: string;
  sort?: 'newest' | 'oldest';
  page?: number;
  pageSize?: number;
}

export interface TransactionPage {
  items: Transaction[];
  totalItems: number;
  page: number;
  pageSize: number;
}

const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'bank-transfer', 'upi', 'other'];

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  constructor(
    @Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase,
    private readonly categoriesService: CategoriesService,
  ) {}

  async create(input: TransactionInput): Promise<Transaction> {
    const normalized = this.validateInput(input);
    await this.categoriesService.ensureDefaults();
    const id = crypto.randomUUID();

    return this.database.transaction(
      'rw',
      this.database.accounts,
      this.database.categories,
      this.database.transactions,
      this.database.ledgerEntries,
      async () => {
        const account = await this.requireAccount(normalized.accountId);
        this.assertAccountCanReceive(account, normalized.occurredAt);
        const category = await this.requireCategory(normalized.categoryId, normalized.type);
        if (category.status !== 'active') throw new Error('Archived categories cannot be used for new transactions.');
        await this.assertBalanceWithinSafeRange(account, normalized.amountPaise, normalized.type);

        const now = new Date().toISOString();
        const transaction: Transaction = {
          ...normalized,
          id,
          description: normalized.description || category.name,
          createdAt: now,
          updatedAt: now,
        };
        const entry = this.createLedgerEntry(transaction);
        await this.database.transactions.add(transaction);
        await this.database.ledgerEntries.add(entry);
        return transaction;
      },
    );
  }

  async update(id: string, input: TransactionInput): Promise<Transaction> {
    const normalized = this.validateInput(input);
    await this.categoriesService.ensureDefaults();

    return this.database.transaction(
      'rw',
      this.database.accounts,
      this.database.categories,
      this.database.transactions,
      this.database.ledgerEntries,
      async () => {
        const existing = await this.database.transactions.get(id);
        if (!existing) throw new Error('Transaction not found.');
        if (existing.type !== 'income' && existing.type !== 'expense') {
          throw new Error('Only income and expense transactions can be edited here.');
        }

        const previousEntries = await this.database.ledgerEntries.where('transactionId').equals(id).toArray();
        this.assertEntryMatchesTransaction(existing, previousEntries);

        const account = await this.requireAccount(normalized.accountId);
        this.assertAccountCanReceive(account, normalized.occurredAt, existing.accountId);
        if (existing.accountId && existing.accountId !== account.id) {
          const previousAccount = await this.requireAccount(existing.accountId);
          await this.getBalanceWithoutTransaction(previousAccount, id);
        }
        const category = await this.requireCategory(normalized.categoryId, normalized.type);
        if (category.status !== 'active' && category.id !== existing.categoryId) {
          throw new Error('Archived categories cannot be used for new transactions.');
        }
        await this.assertBalanceWithinSafeRange(
          account,
          normalized.amountPaise,
          normalized.type,
          id,
        );

        const updated: Transaction = {
          ...existing,
          ...normalized,
          description: normalized.description || category.name,
          fromAccountId: undefined,
          toAccountId: undefined,
          loanId: undefined,
          updatedAt: new Date().toISOString(),
        };
        await this.database.ledgerEntries.delete(previousEntries[0].id);
        await this.database.ledgerEntries.add(this.createLedgerEntry(updated));
        await this.database.transactions.put(updated);
        return updated;
      },
    );
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.transactions,
      this.database.ledgerEntries,
      async () => {
        const transaction = await this.database.transactions.get(id);
        if (!transaction) throw new Error('Transaction not found.');
        if (transaction.loanId || this.isLoanTransaction(transaction.type)) {
          throw new Error('Loan transactions must be managed from their loan record.');
        }
        if (transaction.savingsGoalId || transaction.type === 'savings-contribution' ||
          transaction.type === 'savings-withdrawal') {
          throw new Error('Savings movements must be managed from their goal record.');
        }
        const entries = await this.database.ledgerEntries.where('transactionId').equals(id).toArray();
        this.assertEntryMatchesTransaction(transaction, entries);

        await this.database.ledgerEntries.bulkDelete(entries.map((entry) => entry.id));
        await this.database.transactions.delete(id);
      },
    );
  }

  async get(id: string): Promise<Transaction | undefined> {
    return this.database.transactions.get(id);
  }

  async list(filters: TransactionFilters = {}): Promise<TransactionPage> {
    this.validateFilters(filters);
    const records = await this.fetchByDateRange(filters);
    const search = filters.search?.trim().toLocaleLowerCase();
    const filtered = records.filter((transaction) => {
      if (
        search &&
        !transaction.description.toLocaleLowerCase().includes(search)
      ) {
        return false;
      }
      if (filters.accountId) {
        const matchesAccount =
          transaction.accountId === filters.accountId ||
          transaction.fromAccountId === filters.accountId ||
          transaction.toAccountId === filters.accountId;
        if (!matchesAccount) return false;
      }
      if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
      if (filters.type && filters.type !== 'all' && transaction.type !== filters.type) return false;
      if (filters.fromDate && transaction.occurredAt.slice(0, 10) < filters.fromDate) return false;
      if (filters.toDate && transaction.occurredAt.slice(0, 10) > filters.toDate) return false;
      return true;
    });

    const direction = filters.sort === 'oldest' ? 1 : -1;
    filtered.sort(
      (left, right) =>
        direction * left.occurredAt.localeCompare(right.occurredAt) ||
        direction * left.id.localeCompare(right.id),
    );
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const totalItems = filtered.length;
    const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);

    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      totalItems,
      page,
      pageSize,
    };
  }

  private async fetchByDateRange(filters: TransactionFilters): Promise<Transaction[]> {
    if (!filters.fromDate && !filters.toDate) return this.database.transactions.toArray();
    const lower = filters.fromDate ?? DexieLowerBound;
    const upper = filters.toDate ? `${filters.toDate}\uffff` : DexieUpperBound;
    return this.database.transactions
      .where('occurredAt')
      .between(lower, upper, true, true)
      .toArray();
  }

  private async requireAccount(id: string): Promise<Account> {
    const account = await this.database.accounts.get(id);
    if (!account) throw new Error('Select an existing account.');
    return account;
  }

  private async requireCategory(id: string, type: EntryTransactionType): Promise<Category> {
    const category = await this.database.categories.get(id);
    if (!category) throw new Error('Select a category.');
    if (category.appliesTo !== type) {
      throw new Error(`This category is for ${category.appliesTo}, not ${type}.`);
    }
    return category;
  }

  private assertAccountCanReceive(
    account: Account,
    occurredAt: string,
    existingAccountId?: string,
  ): void {
    if (account.status !== 'active' && account.id !== existingAccountId) {
      throw new Error('Archived accounts cannot receive new transactions.');
    }
    if (occurredAt.slice(0, 10) < account.openingDate) {
      throw new Error('Transaction date cannot be before the account opening date.');
    }
  }

  private async assertBalanceWithinSafeRange(
    account: Account,
    amountPaise: number,
    type: EntryTransactionType,
    excludedTransactionId?: string,
  ): Promise<void> {
    const withoutEditedEntry = await this.getBalanceWithoutTransaction(account, excludedTransactionId);
    const newBalance = withoutEditedEntry + (type === 'income' ? amountPaise : -amountPaise);
    if (!Number.isSafeInteger(newBalance)) {
      throw new RangeError('Transaction would exceed safe account balance precision.');
    }
  }

  private async getBalanceWithoutTransaction(
    account: Account,
    excludedTransactionId?: string,
  ): Promise<number> {
    const entries = await this.database.ledgerEntries.where('accountId').equals(account.id).toArray();
    return entries
      .filter((entry) => entry.transactionId !== excludedTransactionId)
      .reduce((total, entry) => {
        if (!Number.isSafeInteger(entry.amountPaise)) throw new Error('Invalid ledger entry amount.');
        const next = total + entry.amountPaise;
        if (!Number.isSafeInteger(next)) {
          throw new RangeError('Account balance exceeds safe integer precision.');
        }
        return next;
      }, account.openingBalancePaise);
  }

  private createLedgerEntry(transaction: Transaction): LedgerEntry {
    if (!transaction.accountId) throw new Error('Transaction account is required.');
    return {
      id: crypto.randomUUID(),
      transactionId: transaction.id,
      accountId: transaction.accountId,
      occurredAt: transaction.occurredAt,
      amountPaise: transaction.type === 'income' ? transaction.amountPaise : -transaction.amountPaise,
    };
  }

  private assertEntryMatchesTransaction(transaction: Transaction, entries: LedgerEntry[]): void {
    if (transaction.type === 'income' || transaction.type === 'expense') {
      if (!Number.isSafeInteger(transaction.amountPaise) || transaction.amountPaise <= 0) {
        throw new Error('Transaction amount is invalid; no changes were made.');
      }
      const expectedAmount =
        transaction.type === 'income' ? transaction.amountPaise : -transaction.amountPaise;
      if (
        entries.length !== 1 ||
        entries[0].accountId !== transaction.accountId ||
        entries[0].amountPaise !== expectedAmount ||
        entries[0].occurredAt !== transaction.occurredAt
      ) {
        throw new Error('Transaction ledger entries are inconsistent; no changes were made.');
      }
      return;
    }
    if (transaction.type === 'transfer') {
      if (
        !Number.isSafeInteger(transaction.amountPaise) ||
        transaction.amountPaise <= 0 ||
        !transaction.fromAccountId ||
        !transaction.toAccountId ||
        transaction.fromAccountId === transaction.toAccountId
      ) {
        throw new Error('Transfer record is invalid; no changes were made.');
      }
      const debit = entries.find((entry) => entry.accountId === transaction.fromAccountId);
      const credit = entries.find((entry) => entry.accountId === transaction.toAccountId);
      if (
        entries.length !== 2 ||
        !debit ||
        !credit ||
        debit.amountPaise !== -transaction.amountPaise ||
        credit.amountPaise !== transaction.amountPaise ||
        debit.occurredAt !== transaction.occurredAt ||
        credit.occurredAt !== transaction.occurredAt
      ) {
        throw new Error('Transfer ledger entries are inconsistent; no changes were made.');
      }
      return;
    }
    throw new Error('This transaction type cannot be changed in Phase 3.');
  }

  private validateInput(input: TransactionInput): TransactionInput {
    if (input.type !== 'income' && input.type !== 'expense') {
      throw new Error('Choose income or expense.');
    }
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error('Transaction amount must be a positive amount in paise.');
    }
    if (!input.accountId) throw new Error('Select an account.');
    if (!input.categoryId) throw new Error('Select a category.');
    if (!input.occurredAt || !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new Error('Enter a valid transaction date.');
    }

    const date = input.occurredAt.slice(0, 10);
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      throw new Error('Enter a valid transaction date.');
    }

    const description = input.description?.trim() ?? '';
    const notes = input.notes?.trim() ?? '';
    if (description.length > 160) throw new Error('Description cannot exceed 160 characters.');
    if (notes.length > 2000) throw new Error('Notes cannot exceed 2,000 characters.');
    if (input.paymentMethod && !PAYMENT_METHODS.includes(input.paymentMethod)) {
      throw new Error('Choose a valid payment method.');
    }
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length > 20 || tags.some((tag) => tag.length > 30)) {
      throw new Error('Use up to 20 tags, each no longer than 30 characters.');
    }

    return { ...input, description, notes, tags };
  }

  private validateFilters(filters: TransactionFilters): void {
    const isValidDate = (date: string): boolean => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    };
    if (filters.fromDate && !isValidDate(filters.fromDate)) throw new Error('Invalid start date filter.');
    if (filters.toDate && !isValidDate(filters.toDate)) throw new Error('Invalid end date filter.');
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      throw new Error('Start date must be on or before end date.');
    }
  }

  private isLoanTransaction(type: TransactionType): boolean {
    return (
      type === 'money-lent' ||
      type === 'money-borrowed' ||
      type === 'loan-repayment-received' ||
      type === 'loan-repayment-made'
    );
  }
}

const DexieLowerBound = '';
const DexieUpperBound = '\uffff';
