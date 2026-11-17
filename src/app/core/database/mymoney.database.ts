import Dexie, { type Table } from 'dexie';
import type {
  Account,
  AppSetting,
  BudgetAlert,
  Budget,
  Category,
  LedgerEntry,
  LoanEntry,
  Person,
  SavingsGoal,
  SavingsGoalEntry,
  StoredLoan,
  Transaction,
} from '../models/finance.models';

export class MyMoneyDatabase extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  ledgerEntries!: Table<LedgerEntry, string>;
  loans!: Table<StoredLoan, string>;
  loanEntries!: Table<LoanEntry, string>;
  people!: Table<Person, string>;
  categories!: Table<Category, string>;
  budgets!: Table<Budget, string>;
  savingsGoals!: Table<SavingsGoal, string>;
  savingsGoalEntries!: Table<SavingsGoalEntry, string>;
  budgetAlerts!: Table<BudgetAlert, string>;
  settings!: Table<AppSetting, string>;

  constructor(databaseName = 'mymoney') {
    super(databaseName);

    this.version(1).stores({
      accounts: 'id, type, name, createdAt, archivedAt',
      transactions:
        'id, type, occurredAt, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
      ledgerEntries: 'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
      loans: 'id, direction, personName, createdAt, settledAt',
      loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
      categories: 'id, name, appliesTo',
      budgets: 'id, categoryId, period, startsOn, endsOn',
      savingsGoals: 'id, targetDate, linkedAccountId',
      settings: 'key',
    });

    this.version(2)
      .stores({
        accounts: 'id, type, status, name, createdAt, archivedAt',
        transactions:
          'id, type, occurredAt, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
        ledgerEntries:
          'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
        loans: 'id, direction, personName, createdAt, settledAt',
        loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
        categories: 'id, name, appliesTo',
        budgets: 'id, categoryId, period, startsOn, endsOn',
        savingsGoals: 'id, targetDate, linkedAccountId',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction.table('accounts').toCollection().modify((account) => {
          // Legacy bank records did not distinguish savings from current accounts.
          if (account.type === 'bank') account.type = 'other';
          if (account.type === 'cash') account.type = 'cash-wallet';
          if (account.type === 'wallet') account.type = 'digital-wallet';
          account.openingDate ??= account.createdAt.slice(0, 10);
          account.status ??= account.archivedAt ? 'archived' : 'active';
        });
      });

    this.version(3)
      .stores({
        accounts: 'id, type, status, name, createdAt, archivedAt',
        transactions:
          'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
        ledgerEntries:
          'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
        loans: 'id, direction, personName, createdAt, settledAt',
        loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
        categories: 'id, name, appliesTo, status',
        budgets: 'id, categoryId, period, startsOn, endsOn',
        savingsGoals: 'id, targetDate, linkedAccountId',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction.table('transactions').toCollection().modify((record) => {
          record.notes ??= '';
          record.tags ??= [];
        });
        await transaction.table('categories').toCollection().modify((category) => {
          category.status ??= 'active';
          category.isDefault ??= false;
        });
      });

    this.version(4)
      .stores({
        accounts: 'id, type, status, name, createdAt, archivedAt',
        transactions:
          'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, createdAt, updatedAt',
        ledgerEntries:
          'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
        loans: 'id, direction, personId, personName, accountId, startedAt, dueDate, createdAt, settledAt',
        loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
        people: 'id, name, status, createdAt, updatedAt',
        categories: 'id, name, appliesTo, status',
        budgets: 'id, categoryId, period, startsOn, endsOn',
        savingsGoals: 'id, targetDate, linkedAccountId',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        const [loans, loanEntries, transactions] = await Promise.all([
          transaction.table('loans').toArray(),
          transaction.table('loanEntries').toArray(),
          transaction.table('transactions').toArray(),
        ]);
        const transactionById = new Map(transactions.map((entry) => [entry.id, entry]));

        for (const loan of loans) {
          const loanTransactions = transactions.filter((entry) => entry.loanId === loan.id);
          const principalType = loan.direction === 'lent' ? 'money-lent' : 'money-borrowed';
          const principalTransaction = loanTransactions.find((entry) => entry.type === principalType);
          const principalEntries = loanEntries.filter(
            (entry) => entry.loanId === loan.id && entry.outstandingChangePaise > 0,
          );
          const transactionAmount =
            principalTransaction &&
            Number.isSafeInteger(principalTransaction.amountPaise) &&
            principalTransaction.amountPaise > 0
              ? principalTransaction.amountPaise
              : undefined;
          const derivedAmount = transactionAmount ??
            principalEntries.reduce((total, entry) => {
              const next = total + entry.outstandingChangePaise;
              if (!Number.isSafeInteger(next)) throw new RangeError('Legacy loan amount exceeds safe integer precision.');
              return next;
            }, 0);
          const associatedTransaction = principalTransaction ??
            (principalEntries[0] ? transactionById.get(principalEntries[0].transactionId) : undefined);
          const personName = typeof loan.personName === 'string' && loan.personName.trim()
            ? loan.personName.trim()
            : 'Unknown person';
          const person: Person = {
            id: crypto.randomUUID(),
            name: personName,
            status: 'active',
            createdAt: loan.createdAt,
            updatedAt: loan.updatedAt,
          };

          await transaction.table('people').add(person);
          await transaction.table('loans').update(loan.id, {
            personId: person.id,
            amountPaise: Number.isSafeInteger(derivedAmount) && derivedAmount > 0
              ? derivedAmount
              : undefined,
            accountId: associatedTransaction?.accountId,
            startedAt: associatedTransaction?.occurredAt?.slice(0, 10),
          });
        }
      });

    this.version(5).stores({
      accounts: 'id, type, status, name, createdAt, archivedAt',
      transactions:
        'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, savingsGoalId, createdAt, updatedAt',
      ledgerEntries:
        'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
      loans: 'id, direction, personId, personName, accountId, startedAt, dueDate, createdAt, settledAt',
      loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
      people: 'id, name, status, createdAt, updatedAt',
      categories: 'id, name, appliesTo, status',
      budgets: 'id, categoryId, period, startsOn, endsOn, archivedAt, createdAt',
      budgetAlerts: 'id, budgetId, periodStart, [budgetId+periodStart]',
      savingsGoals: 'id, targetDate, linkedAccountId, createdAt',
      savingsGoalEntries: 'id, goalId, transactionId, accountId, occurredAt, [goalId+occurredAt]',
      settings: 'key',
    });

    this.version(6)
      .stores({
        accounts: 'id, type, status, name, createdAt, archivedAt',
        transactions:
          'id, type, occurredAt, accountId, categoryId, fromAccountId, toAccountId, loanId, savingsGoalId, createdAt, updatedAt',
        ledgerEntries:
          'id, transactionId, accountId, occurredAt, [accountId+occurredAt]',
        loans: 'id, direction, personId, personName, accountId, startedAt, dueDate, createdAt, settledAt',
        loanEntries: 'id, transactionId, loanId, occurredAt, [loanId+occurredAt]',
        people: 'id, name, status, createdAt, updatedAt',
        categories: 'id, name, appliesTo, status',
        budgets: 'id, categoryId, period, startsOn, endsOn, archivedAt, createdAt',
        budgetAlerts: 'id, budgetId, periodStart, [budgetId+periodStart]',
        savingsGoals: 'id, targetDate, linkedAccountId, status, archivedAt, createdAt',
        savingsGoalEntries: 'id, goalId, transactionId, accountId, occurredAt, [goalId+occurredAt]',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction.table('savingsGoals').toCollection().modify((goal) => {
          goal.status ??= 'active';
        });
      });
  }
}

export const myMoneyDatabase = new MyMoneyDatabase();
