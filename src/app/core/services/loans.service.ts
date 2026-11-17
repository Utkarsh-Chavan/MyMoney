import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type {
  Account,
  LedgerEntry,
  Loan,
  LoanDirection,
  LoanEntry,
  Person,
  PersonStatus,
  StoredLoan,
  Transaction,
} from '../models/finance.models';
import { dateInputToTimestamp, localDateInputValue } from '../utilities/money';

export type LoanStatus = 'open' | 'partially-repaid' | 'settled' | 'overdue' | 'needs-review';

export interface PersonInput {
  name: string;
  phoneNumber?: string;
  notes?: string;
}

export interface LoanInput {
  direction: LoanDirection;
  personId: string;
  amountPaise: number;
  accountId: string;
  startedAt: string;
  dueDate?: string;
  description?: string;
  notes?: string;
}

export interface RepaymentInput {
  amountPaise: number;
  accountId: string;
  occurredAt: string;
  notes?: string;
}

export interface LoanFilters {
  personId?: string;
  direction?: LoanDirection | 'all';
  status?: LoanStatus | 'all';
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface LoanSummary {
  loan: StoredLoan;
  person?: Person;
  principalPaise: number | null;
  repaidPaise: number | null;
  outstandingPaise: number;
  status: LoanStatus;
}

export interface LoanPage {
  items: LoanSummary[];
  totalItems: number;
  page: number;
  pageSize: number;
}

export interface LoanHistoryItem {
  entry: LoanEntry;
  transaction: Transaction;
  account?: Account;
}

export interface LoanDetails {
  summary: LoanSummary;
  history: LoanHistoryItem[];
}

export interface LoanDashboardSummary {
  totalLentPaise: number;
  totalBorrowedPaise: number;
  receivablePaise: number;
  payablePaise: number;
  outstandingPaise: number;
  outstandingCount: number;
  settledCount: number;
  partiallyRepaidCount: number;
  overdueCount: number;
  needsReviewCount: number;
}

interface LoanSnapshot {
  loans: StoredLoan[];
  people: Person[];
  loanEntries: LoanEntry[];
  transactions: Transaction[];
  ledgerEntries: LedgerEntry[];
  accounts: Account[];
}

@Injectable({ providedIn: 'root' })
export class LoansService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async listPeople(status?: PersonStatus): Promise<Person[]> {
    const people = status
      ? await this.database.people.where('status').equals(status).toArray()
      : await this.database.people.toArray();
    return people.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return this.database.people.get(id);
  }

  async createPerson(input: PersonInput): Promise<Person> {
    const normalized = this.validatePersonInput(input);
    const now = new Date().toISOString();
    const person: Person = {
      ...normalized,
      id: crypto.randomUUID(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.database.people.add(person);
    return person;
  }

  async updatePerson(id: string, input: PersonInput): Promise<Person> {
    const normalized = this.validatePersonInput(input);
    return this.database.transaction('rw', this.database.people, async () => {
      const current = await this.database.people.get(id);
      if (!current) throw new Error('Person not found.');
      const updated: Person = { ...current, ...normalized, updatedAt: new Date().toISOString() };
      await this.database.people.put(updated);
      return updated;
    });
  }

  async archivePerson(id: string): Promise<Person> {
    return this.database.transaction('rw', this.database.people, async () => {
      const person = await this.database.people.get(id);
      if (!person) throw new Error('Person not found.');
      if (person.status === 'archived') return person;
      const now = new Date().toISOString();
      const archived: Person = { ...person, status: 'archived', archivedAt: now, updatedAt: now };
      await this.database.people.put(archived);
      return archived;
    });
  }

  async createLoan(input: LoanInput): Promise<Loan> {
    const normalized = this.validateLoanInput(input);
    const transactionId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const ledgerEntryId = crypto.randomUUID();
    const occurredAt = this.requireDateTimestamp(normalized.startedAt, 'loan date');

    return this.database.transaction(
      'rw',
      [
        this.database.people,
        this.database.accounts,
        this.database.loans,
        this.database.loanEntries,
        this.database.transactions,
        this.database.ledgerEntries,
      ],
      async () => {
        const person = await this.requireActivePerson(normalized.personId);
        const account = await this.requireActiveAccount(normalized.accountId);
        this.assertDateForAccount(account, normalized.startedAt);
        const ledgerChange = normalized.direction === 'lent'
          ? -normalized.amountPaise
          : normalized.amountPaise;
        await this.assertBalanceWithinSafeRange(account, ledgerChange);

        const now = new Date().toISOString();
        const loan: Loan = {
          ...normalized,
          id: loanId,
          createdAt: now,
          updatedAt: now,
        };
        const transaction: Transaction = {
          id: transactionId,
          type: normalized.direction === 'lent' ? 'money-lent' : 'money-borrowed',
          amountPaise: normalized.amountPaise,
          occurredAt,
          description: this.loanDescription(normalized.description, person, normalized.direction),
          accountId: account.id,
          loanId,
          notes: normalized.notes,
          createdAt: now,
          updatedAt: now,
        };
        const loanEntry: LoanEntry = {
          id: entryId,
          transactionId,
          loanId,
          occurredAt,
          outstandingChangePaise: normalized.amountPaise,
        };
        const ledgerEntry: LedgerEntry = {
          id: ledgerEntryId,
          transactionId,
          accountId: account.id,
          occurredAt,
          amountPaise: ledgerChange,
        };

        await this.database.loans.add(loan);
        await this.database.transactions.add(transaction);
        await this.database.loanEntries.add(loanEntry);
        await this.database.ledgerEntries.add(ledgerEntry);
        return loan;
      },
    );
  }

  async updateLoan(id: string, input: LoanInput): Promise<Loan> {
    const normalized = this.validateLoanInput(input);
    const occurredAt = this.requireDateTimestamp(normalized.startedAt, 'loan date');
    return this.database.transaction(
      'rw',
      [
        this.database.people,
        this.database.accounts,
        this.database.loans,
        this.database.loanEntries,
        this.database.transactions,
        this.database.ledgerEntries,
      ],
      async () => {
        const stored = await this.database.loans.get(id);
        const loan = this.requireManagedLoan(stored);
        const snapshot = await this.readLoanRecords(id);
        this.assertLoanRecordsAreConsistent(loan, snapshot.entries, snapshot.transactions, snapshot.ledgerEntries);

        const principalEntry = snapshot.entries.find((entry) => entry.outstandingChangePaise > 0);
        const principalTransaction = principalEntry
          ? snapshot.transactions.find((transaction) => transaction.id === principalEntry.transactionId)
          : undefined;
        const principalLedgerEntry = principalTransaction
          ? snapshot.ledgerEntries.find((entry) => entry.transactionId === principalTransaction.id)
          : undefined;
        if (!principalEntry || !principalTransaction || !principalLedgerEntry) {
          throw new Error('Loan history is inconsistent; no changes were made.');
        }

        const hasRepayments = snapshot.entries.some((entry) => entry.outstandingChangePaise < 0);
        const financialFieldsChanged =
          normalized.direction !== loan.direction ||
          normalized.personId !== loan.personId ||
          normalized.amountPaise !== loan.amountPaise ||
          normalized.accountId !== loan.accountId ||
          normalized.startedAt !== loan.startedAt;
        if (hasRepayments && financialFieldsChanged) {
          throw new Error('Loan amount, direction, person, account and start date cannot change after repayments.');
        }

        const person = normalized.personId === loan.personId
          ? await this.requirePerson(normalized.personId)
          : await this.requireActivePerson(normalized.personId);
        const account = await this.requireAccount(normalized.accountId);
        if (account.id !== loan.accountId && account.status !== 'active') {
          throw new Error('Archived accounts cannot receive new loan transactions.');
        }
        this.assertDateForAccount(account, normalized.startedAt);
        if (!hasRepayments) {
          const nextLedgerChange = normalized.direction === 'lent'
            ? -normalized.amountPaise
            : normalized.amountPaise;
          await this.assertEditedBalanceWithinSafeRange(
            principalTransaction,
            principalLedgerEntry,
            account,
            nextLedgerChange,
          );
        }

        const now = new Date().toISOString();
        const updated: Loan = { ...normalized, id, createdAt: loan.createdAt, updatedAt: now };
        const updatedTransaction: Transaction = {
          ...principalTransaction,
          type: normalized.direction === 'lent' ? 'money-lent' : 'money-borrowed',
          amountPaise: normalized.amountPaise,
          occurredAt,
          description: this.loanDescription(normalized.description, person, normalized.direction),
          accountId: account.id,
          notes: normalized.notes,
          updatedAt: now,
        };

        await this.database.loans.put(updated);
        await this.database.transactions.put(updatedTransaction);
        await this.database.loanEntries.put({
          ...principalEntry,
          occurredAt,
          outstandingChangePaise: normalized.amountPaise,
        });
        await this.database.ledgerEntries.put({
          ...principalLedgerEntry,
          accountId: account.id,
          occurredAt,
          amountPaise: normalized.direction === 'lent' ? -normalized.amountPaise : normalized.amountPaise,
        });
        return updated;
      },
    );
  }

  async deleteLoan(id: string): Promise<void> {
    await this.database.transaction(
      'rw',
      [
        this.database.loans,
        this.database.loanEntries,
        this.database.transactions,
        this.database.ledgerEntries,
      ],
      async () => {
        const stored = await this.database.loans.get(id);
        const loan = this.requireManagedLoan(stored);
        const snapshot = await this.readLoanRecords(id);
        this.assertLoanRecordsAreConsistent(loan, snapshot.entries, snapshot.transactions, snapshot.ledgerEntries);
        if (snapshot.entries.some((entry) => entry.outstandingChangePaise < 0)) {
          throw new Error('Loans with repayment history cannot be deleted; archive the person instead.');
        }
        const principalTransaction = snapshot.transactions[0];
        if (!principalTransaction) throw new Error('Loan history is inconsistent; no changes were made.');
        await this.database.ledgerEntries.where('transactionId').equals(principalTransaction.id).delete();
        await this.database.loanEntries.where('loanId').equals(id).delete();
        await this.database.transactions.delete(principalTransaction.id);
        await this.database.loans.delete(id);
      },
    );
  }

  async createRepayment(loanId: string, input: RepaymentInput): Promise<Transaction> {
    const normalized = this.validateRepaymentInput(input);
    const occurredAt = this.requireDateTimestamp(normalized.occurredAt, 'repayment date');
    const transactionId = crypto.randomUUID();
    const loanEntryId = crypto.randomUUID();
    const ledgerEntryId = crypto.randomUUID();

    return this.database.transaction(
      'rw',
      [
        this.database.people,
        this.database.accounts,
        this.database.loans,
        this.database.loanEntries,
        this.database.transactions,
        this.database.ledgerEntries,
      ],
      async () => {
        const stored = await this.database.loans.get(loanId);
        const loan = this.requireManagedLoan(stored);
        const snapshot = await this.readLoanRecords(loanId);
        this.assertLoanRecordsAreConsistent(loan, snapshot.entries, snapshot.transactions, snapshot.ledgerEntries);
        const outstandingPaise = this.sumSafe(
          snapshot.entries.map((entry) => this.validateMoneyChange(entry.outstandingChangePaise)),
          'Loan outstanding amount',
        );
        if (outstandingPaise <= 0) throw new Error('This loan is already settled.');
        if (normalized.amountPaise > outstandingPaise) {
          throw new Error('Repayment cannot exceed the outstanding loan amount.');
        }
        if (normalized.occurredAt < loan.startedAt) {
          throw new Error('Repayment date cannot be before the loan start date.');
        }

        const person = await this.requirePerson(loan.personId);
        const account = await this.requireActiveAccount(normalized.accountId);
        this.assertDateForAccount(account, normalized.occurredAt);
        const ledgerChange = loan.direction === 'lent'
          ? normalized.amountPaise
          : -normalized.amountPaise;
        await this.assertBalanceWithinSafeRange(account, ledgerChange);

        const now = new Date().toISOString();
        const type = loan.direction === 'lent' ? 'loan-repayment-received' : 'loan-repayment-made';
        const transaction: Transaction = {
          id: transactionId,
          type,
          amountPaise: normalized.amountPaise,
          occurredAt,
          description: loan.direction === 'lent'
            ? `Repayment from ${person.name}`
            : `Repayment to ${person.name}`,
          accountId: account.id,
          loanId,
          notes: normalized.notes,
          createdAt: now,
          updatedAt: now,
        };
        const loanEntry: LoanEntry = {
          id: loanEntryId,
          transactionId,
          loanId,
          occurredAt,
          outstandingChangePaise: -normalized.amountPaise,
        };
        const ledgerEntry: LedgerEntry = {
          id: ledgerEntryId,
          transactionId,
          accountId: account.id,
          occurredAt,
          amountPaise: ledgerChange,
        };
        const settledAt = normalized.amountPaise === outstandingPaise ? now : undefined;

        await this.database.transactions.add(transaction);
        await this.database.loanEntries.add(loanEntry);
        await this.database.ledgerEntries.add(ledgerEntry);
        await this.database.loans.put({ ...loan, settledAt, updatedAt: now });
        return transaction;
      },
    );
  }

  async list(filters: LoanFilters = {}): Promise<LoanPage> {
    this.validateFilters(filters);
    const summaries = await this.readSummaries();
    const filtered = summaries
      .filter(({ loan, status }) => {
        if (filters.personId && loan.personId !== filters.personId) return false;
        if (filters.direction && filters.direction !== 'all' && loan.direction !== filters.direction) return false;
        if (filters.status && filters.status !== 'all' && status !== filters.status) return false;
        const date = 'startedAt' in loan && loan.startedAt
          ? loan.startedAt
          : loan.createdAt.slice(0, 10);
        if (filters.fromDate && date < filters.fromDate) return false;
        if (filters.toDate && date > filters.toDate) return false;
        return true;
      })
      .sort((left, right) => {
        const leftDate = 'startedAt' in left.loan && left.loan.startedAt
          ? left.loan.startedAt
          : left.loan.createdAt.slice(0, 10);
        const rightDate = 'startedAt' in right.loan && right.loan.startedAt
          ? right.loan.startedAt
          : right.loan.createdAt.slice(0, 10);
        return rightDate.localeCompare(leftDate) || left.loan.id.localeCompare(right.loan.id);
      });

    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount);
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      totalItems: filtered.length,
      page,
      pageSize,
    };
  }

  async getLoan(id: string): Promise<LoanSummary | undefined> {
    return (await this.readSummaries()).find(({ loan }) => loan.id === id);
  }

  async getDetails(id: string): Promise<LoanDetails | undefined> {
    const snapshot = await this.readSnapshot();
    const summary = this.buildSummaries(snapshot).find(({ loan }) => loan.id === id);
    if (!summary) return undefined;
    const transactionsById = new Map(snapshot.transactions.map((transaction) => [transaction.id, transaction]));
    const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));
    const history = snapshot.loanEntries
      .filter((entry) => entry.loanId === id)
      .map((entry): LoanHistoryItem => {
        const transaction = transactionsById.get(entry.transactionId);
        if (!transaction) throw new Error(`Missing transaction for loan history entry ${entry.id}.`);
        return { entry, transaction, account: transaction.accountId ? accountsById.get(transaction.accountId) : undefined };
      })
      .sort((left, right) => right.entry.occurredAt.localeCompare(left.entry.occurredAt));
    return { summary, history };
  }

  async getDashboardSummary(): Promise<LoanDashboardSummary> {
    const summaries = await this.readSummaries();
    const lent = summaries.filter(({ loan }) => loan.direction === 'lent');
    const borrowed = summaries.filter(({ loan }) => loan.direction === 'borrowed');
    const receivablePaise = this.sumSafe(lent.map(({ outstandingPaise }) => outstandingPaise), 'Loan total');
    const payablePaise = this.sumSafe(borrowed.map(({ outstandingPaise }) => outstandingPaise), 'Loan total');
    const outstanding = summaries.filter(({ outstandingPaise }) => outstandingPaise > 0);

    return {
      totalLentPaise: this.sumSafe(
        lent.map(({ principalPaise }) => principalPaise ?? 0),
        'Loan total',
      ),
      totalBorrowedPaise: this.sumSafe(
        borrowed.map(({ principalPaise }) => principalPaise ?? 0),
        'Loan total',
      ),
      receivablePaise,
      payablePaise,
      outstandingPaise: this.sumSafe(outstanding.map(({ outstandingPaise }) => outstandingPaise), 'Loan total'),
      outstandingCount: outstanding.length,
      settledCount: summaries.filter(({ status }) => status === 'settled').length,
      partiallyRepaidCount: summaries.filter(({ status }) => status === 'partially-repaid').length,
      overdueCount: summaries.filter(({ status }) => status === 'overdue').length,
      needsReviewCount: summaries.filter(({ status }) => status === 'needs-review').length,
    };
  }

  private async readSummaries(): Promise<LoanSummary[]> {
    return this.buildSummaries(await this.readSnapshot());
  }

  private async readSnapshot(): Promise<LoanSnapshot> {
    return this.database.transaction(
      'r',
      [
        this.database.loans,
        this.database.people,
        this.database.loanEntries,
        this.database.transactions,
        this.database.ledgerEntries,
        this.database.accounts,
      ],
      async () => {
        const [loans, people, loanEntries, transactions, accounts] = await Promise.all([
          this.database.loans.toArray(),
          this.database.people.toArray(),
          this.database.loanEntries.toArray(),
          this.database.transactions.toArray(),
          this.database.accounts.toArray(),
        ]);
        const transactionIds = new Set(loanEntries.map((entry) => entry.transactionId));
        const ledgerEntries = transactions
          .filter((transaction) => transactionIds.has(transaction.id))
          .length === 0
          ? []
          : await this.database.ledgerEntries
            .where('transactionId')
            .anyOf([...transactionIds])
            .toArray();
        return { loans, people, loanEntries, transactions, ledgerEntries, accounts };
      },
    );
  }

  private buildSummaries(snapshot: LoanSnapshot): LoanSummary[] {
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    const transactionsById = new Map(snapshot.transactions.map((transaction) => [transaction.id, transaction]));
    const ledgerEntriesByTransaction = this.groupBy(snapshot.ledgerEntries, (entry) => entry.transactionId);
    const loanEntriesByLoan = this.groupBy(snapshot.loanEntries, (entry) => entry.loanId);
    const transactionsByLoan = this.groupBy(
      snapshot.transactions.filter((transaction) => transaction.loanId),
      (transaction) => transaction.loanId ?? '',
    );

    return snapshot.loans.map((loan): LoanSummary => {
      const entries = loanEntriesByLoan.get(loan.id) ?? [];
      const outstandingPaise = this.sumSafe(
        entries.map((entry) => this.validateMoneyChange(entry.outstandingChangePaise)),
        'Loan outstanding amount',
      );
      if (outstandingPaise < 0) throw new Error('Loan history has a negative outstanding balance.');

      const principalEntries = entries.filter((entry) => entry.outstandingChangePaise > 0);
      const derivedPrincipal = this.sumSafe(
        principalEntries.map((entry) => entry.outstandingChangePaise),
        'Loan principal',
      );
      const principalPaise = this.isManagedLoan(loan)
        ? loan.amountPaise
        : (loan.amountPaise ?? (derivedPrincipal > 0 ? derivedPrincipal : null));
      const repaidPaise = principalPaise === null ? null : principalPaise - outstandingPaise;
      if (repaidPaise !== null && (repaidPaise < 0 || !Number.isSafeInteger(repaidPaise))) {
        throw new Error('Loan history is inconsistent with its principal amount.');
      }

      if (this.isManagedLoan(loan)) {
        this.assertLoanRecordsAreConsistent(
          loan,
          entries,
          transactionsByLoan.get(loan.id) ?? [],
          entries.flatMap((entry) => ledgerEntriesByTransaction.get(entry.transactionId) ?? []),
        );
        if (!peopleById.has(loan.personId)) throw new Error('Loan refers to a missing person.');
        if (outstandingPaise > loan.amountPaise) {
          throw new Error('Loan history is inconsistent with its principal amount.');
        }
      } else {
        for (const entry of entries) {
          if (!transactionsById.has(entry.transactionId)) {
            throw new Error(`Missing transaction for legacy loan history entry ${entry.id}.`);
          }
        }
      }

      const personId = 'personId' in loan ? loan.personId : undefined;
      const person = personId ? peopleById.get(personId) : undefined;
      return {
        loan,
        person,
        principalPaise,
        repaidPaise,
        outstandingPaise,
        status: this.loanStatus(loan, outstandingPaise, repaidPaise),
      };
    });
  }

  private loanStatus(loan: StoredLoan, outstandingPaise: number, repaidPaise: number | null): LoanStatus {
    if (!this.isManagedLoan(loan)) return 'needs-review';
    if (outstandingPaise === 0) return 'settled';
    if (loan.dueDate && loan.dueDate < localDateInputValue()) return 'overdue';
    if (repaidPaise !== null && repaidPaise > 0) return 'partially-repaid';
    return 'open';
  }

  private async readLoanRecords(id: string): Promise<{
    entries: LoanEntry[];
    transactions: Transaction[];
    ledgerEntries: LedgerEntry[];
  }> {
    const entries = await this.database.loanEntries.where('loanId').equals(id).toArray();
    const transactions = await this.database.transactions.where('loanId').equals(id).toArray();
    const ledgerEntries = transactions.length === 0
      ? []
      : await this.database.ledgerEntries
        .where('transactionId')
        .anyOf(transactions.map((transaction) => transaction.id))
        .toArray();
    return { entries, transactions, ledgerEntries };
  }

  private assertLoanRecordsAreConsistent(
    loan: Loan,
    entries: LoanEntry[],
    transactions: Transaction[],
    ledgerEntries: LedgerEntry[],
  ): void {
    const principalEntries = entries.filter((entry) => entry.outstandingChangePaise > 0);
    if (principalEntries.length !== 1 || principalEntries[0]?.outstandingChangePaise !== loan.amountPaise) {
      throw new Error('Loan history is inconsistent; no changes were made.');
    }
    if (entries.length !== transactions.length) {
      throw new Error('Loan history is inconsistent; no changes were made.');
    }
    const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const ledgerByTransaction = this.groupBy(ledgerEntries, (entry) => entry.transactionId);
    const principalType = loan.direction === 'lent' ? 'money-lent' : 'money-borrowed';
    const repaymentType = loan.direction === 'lent' ? 'loan-repayment-received' : 'loan-repayment-made';

    for (const entry of entries) {
      const transaction = transactionsById.get(entry.transactionId);
      if (!transaction || transaction.loanId !== loan.id) {
        throw new Error('Loan history is inconsistent; no changes were made.');
      }
      const isPrincipal = entry.outstandingChangePaise > 0;
      const expectedType = isPrincipal ? principalType : repaymentType;
      const expectedLedgerAmount = loan.direction === 'lent'
        ? -entry.outstandingChangePaise
        : entry.outstandingChangePaise;
      const linkedLedger = ledgerByTransaction.get(transaction.id) ?? [];
      const dateMatchesLoan = isPrincipal
        ? transaction.occurredAt.slice(0, 10) === loan.startedAt && transaction.accountId === loan.accountId
        : transaction.occurredAt.slice(0, 10) >= loan.startedAt;
      if (
        !Number.isSafeInteger(entry.outstandingChangePaise) ||
        entry.outstandingChangePaise === 0 ||
        transaction.type !== expectedType ||
        transaction.amountPaise !== Math.abs(entry.outstandingChangePaise) ||
        transaction.occurredAt !== entry.occurredAt ||
        !dateMatchesLoan ||
        !transaction.accountId ||
        linkedLedger.length !== 1 ||
        linkedLedger[0]?.accountId !== transaction.accountId ||
        linkedLedger[0]?.occurredAt !== transaction.occurredAt ||
        linkedLedger[0]?.amountPaise !== expectedLedgerAmount
      ) {
        throw new Error('Loan history and account ledger are inconsistent; no changes were made.');
      }
    }
    if (transactions.some((transaction) => !entries.some((entry) => entry.transactionId === transaction.id))) {
      throw new Error('Loan history is inconsistent; no changes were made.');
    }
  }

  private async requireActivePerson(id: string): Promise<Person> {
    const person = await this.requirePerson(id);
    if (person.status !== 'active') throw new Error('Archived people cannot be used for new loans.');
    return person;
  }

  private async requirePerson(id: string): Promise<Person> {
    if (!id) throw new Error('Select a person.');
    const person = await this.database.people.get(id);
    if (!person) throw new Error('Select an existing person.');
    return person;
  }

  private async requireActiveAccount(id: string): Promise<Account> {
    const account = await this.requireAccount(id);
    if (account.status !== 'active') throw new Error('Archived accounts cannot receive new loan transactions.');
    return account;
  }

  private async requireAccount(id: string): Promise<Account> {
    if (!id) throw new Error('Select an account.');
    const account = await this.database.accounts.get(id);
    if (!account) throw new Error('Select an existing account.');
    return account;
  }

  private async assertBalanceWithinSafeRange(account: Account, changePaise: number): Promise<void> {
    const entries = await this.database.ledgerEntries.where('accountId').equals(account.id).toArray();
    const balance = this.sumSafe(
      [account.openingBalancePaise, ...entries.map((entry) => entry.amountPaise), changePaise],
      'Account balance',
    );
    if (!Number.isSafeInteger(balance)) throw new RangeError('Loan would exceed safe account balance precision.');
  }

  private async assertEditedBalanceWithinSafeRange(
    previousTransaction: Transaction,
    previousLedgerEntry: LedgerEntry,
    nextAccount: Account,
    nextChangePaise: number,
  ): Promise<void> {
    const previousAccount = await this.requireAccount(previousLedgerEntry.accountId);
    const previousEntries = await this.database.ledgerEntries.where('accountId').equals(previousAccount.id).toArray();
    const previousBalanceWithoutLoan = this.sumSafe(
      [
        previousAccount.openingBalancePaise,
        ...previousEntries
          .filter((entry) => entry.transactionId !== previousTransaction.id)
          .map((entry) => entry.amountPaise),
      ],
      'Account balance',
    );
    if (previousAccount.id === nextAccount.id) {
      this.sumSafe([previousBalanceWithoutLoan, nextChangePaise], 'Account balance');
      return;
    }

    const nextEntries = await this.database.ledgerEntries.where('accountId').equals(nextAccount.id).toArray();
    this.sumSafe(
      [nextAccount.openingBalancePaise, ...nextEntries.map((entry) => entry.amountPaise), nextChangePaise],
      'Account balance',
    );
  }

  private assertDateForAccount(account: Account, date: string): void {
    if (date < account.openingDate) {
      throw new Error('Loan or repayment date cannot be before the account opening date.');
    }
  }

  private validatePersonInput(input: PersonInput): PersonInput {
    const name = input.name.trim();
    const phoneNumber = input.phoneNumber?.trim() || undefined;
    const notes = input.notes?.trim() || undefined;
    if (!name) throw new Error('Person name cannot be empty.');
    if (name.length > 100) throw new Error('Person name cannot exceed 100 characters.');
    if ((phoneNumber?.length ?? 0) > 50) throw new Error('Phone number cannot exceed 50 characters.');
    if ((notes?.length ?? 0) > 2_000) throw new Error('Notes cannot exceed 2,000 characters.');
    return { name, phoneNumber, notes };
  }

  private validateLoanInput(input: LoanInput): LoanInput {
    if (input.direction !== 'lent' && input.direction !== 'borrowed') {
      throw new Error('Choose money lent or money borrowed.');
    }
    this.validateMoney(input.amountPaise);
    if (!input.personId) throw new Error('Select a person.');
    if (!input.accountId) throw new Error('Select an account.');
    if (!dateInputToTimestamp(input.startedAt)) throw new Error('Enter a valid loan date.');
    if (input.dueDate && !dateInputToTimestamp(input.dueDate)) throw new Error('Enter a valid due date.');
    if (input.dueDate && input.dueDate < input.startedAt) {
      throw new Error('Due date cannot be before the loan date.');
    }
    const description = input.description?.trim() || undefined;
    const notes = input.notes?.trim() || undefined;
    if ((description?.length ?? 0) > 160) throw new Error('Description cannot exceed 160 characters.');
    if ((notes?.length ?? 0) > 2_000) throw new Error('Notes cannot exceed 2,000 characters.');
    return { ...input, description, notes, dueDate: input.dueDate || undefined };
  }

  private validateRepaymentInput(input: RepaymentInput): RepaymentInput {
    this.validateMoney(input.amountPaise);
    if (!input.accountId) throw new Error('Select an account.');
    if (!dateInputToTimestamp(input.occurredAt)) throw new Error('Enter a valid repayment date.');
    const notes = input.notes?.trim() || undefined;
    if ((notes?.length ?? 0) > 2_000) throw new Error('Notes cannot exceed 2,000 characters.');
    return { ...input, notes };
  }

  private validateFilters(filters: LoanFilters): void {
    if (filters.direction && !['all', 'lent', 'borrowed'].includes(filters.direction)) {
      throw new Error('Invalid loan direction filter.');
    }
    if (
      filters.status &&
      !['all', 'open', 'partially-repaid', 'settled', 'overdue', 'needs-review'].includes(filters.status)
    ) {
      throw new Error('Invalid loan status filter.');
    }
    if (filters.fromDate && !dateInputToTimestamp(filters.fromDate)) throw new Error('Invalid start date filter.');
    if (filters.toDate && !dateInputToTimestamp(filters.toDate)) throw new Error('Invalid end date filter.');
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      throw new Error('Start date must be on or before end date.');
    }
  }

  private requireDateTimestamp(date: string, label: string): string {
    const timestamp = dateInputToTimestamp(date);
    if (!timestamp) throw new Error(`Enter a valid ${label}.`);
    return timestamp;
  }

  private validateMoney(amountPaise: number): number {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error('Amount must be a positive amount in integer paise.');
    }
    return amountPaise;
  }

  private loanDescription(description: string | undefined, person: Person, direction: LoanDirection): string {
    if (description) return description;
    return direction === 'lent' ? `Money lent to ${person.name}` : `Money borrowed from ${person.name}`;
  }

  private isManagedLoan(loan: StoredLoan): loan is Loan {
    return (
      typeof loan.personId === 'string' &&
      loan.personId.length > 0 &&
      typeof loan.accountId === 'string' &&
      loan.accountId.length > 0 &&
      typeof loan.startedAt === 'string' &&
      !!dateInputToTimestamp(loan.startedAt) &&
      typeof loan.amountPaise === 'number' &&
      Number.isSafeInteger(loan.amountPaise) &&
      loan.amountPaise > 0
    );
  }

  private requireManagedLoan(loan: StoredLoan | undefined): Loan {
    if (!loan) throw new Error('Loan not found.');
    if (!this.isManagedLoan(loan)) {
      throw new Error('This legacy loan is missing principal details and cannot be changed until reviewed.');
    }
    return loan;
  }

  private validateMoneyChange(amountPaise: number): number {
    if (!Number.isSafeInteger(amountPaise)) throw new Error('Loan history contains an invalid amount.');
    return amountPaise;
  }

  private sumSafe(values: number[], label: string): number {
    return values.reduce((total, value) => {
      if (!Number.isSafeInteger(value)) throw new Error(`${label} contains an invalid amount.`);
      const next = total + value;
      if (!Number.isSafeInteger(next)) throw new RangeError(`${label} exceeds safe integer precision.`);
      return next;
    }, 0);
  }

  private groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const key = keyOf(item);
      const values = grouped.get(key) ?? [];
      values.push(item);
      grouped.set(key, values);
    }
    return grouped;
  }
}
