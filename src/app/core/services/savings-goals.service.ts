import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type {
  Account,
  LedgerEntry,
  SavingsGoal,
  SavingsGoalEntry,
  Transaction,
} from '../models/finance.models';

export interface SavingsGoalInput {
  name: string;
  targetAmountPaise: number;
  targetDate?: string;
  linkedAccountId?: string;
  notes?: string;
}

export interface SavingsGoalProgress {
  goal: SavingsGoal;
  savedPaise: number;
  percentComplete: number;
  remainingPaise: number;
}

export interface SavingsGoalHistoryItem {
  entry: SavingsGoalEntry;
  transaction: Transaction;
}

export interface SavingsGoalDetails extends SavingsGoalProgress {
  history: SavingsGoalHistoryItem[];
}

export interface SavingsGoalMovementInput {
  amountPaise: number;
  accountId: string;
  occurredAt: string;
  notes?: string;
}

const ALLOW_NEGATIVE_SETTING = 'accounts.allowNegativeBalances';

@Injectable({ providedIn: 'root' })
export class SavingsGoalsService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async create(input: SavingsGoalInput): Promise<SavingsGoal> {
    await this.validateInput(input);
    const now = new Date().toISOString();
    const goal: SavingsGoal = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      targetAmountPaise: input.targetAmountPaise,
      targetDate: input.targetDate || undefined,
      linkedAccountId: input.linkedAccountId || undefined,
      notes: input.notes?.trim() || undefined,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.database.savingsGoals.add(goal);
    return goal;
  }

  async update(id: string, input: SavingsGoalInput): Promise<SavingsGoal> {
    await this.validateInput(input);
    return this.database.transaction('rw', [this.database.savingsGoals, this.database.savingsGoalEntries], async () => {
      const existing = await this.database.savingsGoals.get(id);
      if (!existing) throw new Error('Savings goal not found.');
      if (existing.status === 'archived') throw new Error('Archived savings goals cannot be edited.');
      const savedPaise = await this.currentSaved(id);
      const updated: SavingsGoal = {
        ...existing,
        name: input.name.trim(),
        targetAmountPaise: input.targetAmountPaise,
        targetDate: input.targetDate || undefined,
        linkedAccountId: input.linkedAccountId || undefined,
        notes: input.notes?.trim() || undefined,
        status: savedPaise >= input.targetAmountPaise ? 'completed' : 'active',
        updatedAt: new Date().toISOString(),
      };
      await this.database.savingsGoals.put(updated);
      return updated;
    });
  }

  async archive(id: string): Promise<void> {
    await this.database.transaction('rw', [this.database.savingsGoals, this.database.savingsGoalEntries], async () => {
      const goal = await this.database.savingsGoals.get(id);
      if (!goal) throw new Error('Savings goal not found.');
      if (goal.status === 'archived') return;
      const savedPaise = await this.currentSaved(id);
      if (savedPaise < goal.targetAmountPaise) {
        throw new Error('Only completed savings goals can be archived.');
      }
      const now = new Date().toISOString();
      await this.database.savingsGoals.update(id, {
        status: 'archived',
        archivedAt: now,
        updatedAt: now,
      });
    });
  }

  async list(): Promise<SavingsGoalProgress[]> {
    const goals = await this.database.savingsGoals.orderBy('createdAt').reverse().toArray();
    return Promise.all(goals.map((goal) => this.progress(goal)));
  }

  async getDetails(id: string): Promise<SavingsGoalDetails | undefined> {
    const goal = await this.database.savingsGoals.get(id);
    if (!goal) return undefined;
    const [summary, entries] = await Promise.all([
      this.progress(goal),
      this.database.savingsGoalEntries.where('goalId').equals(id).toArray(),
    ]);
    const transactions = await this.database.transactions.bulkGet(entries.map(({ transactionId }) => transactionId));
    const history = entries.map((entry, index) => {
      const transaction = transactions[index];
      if (!transaction) throw new Error(`Missing transaction for savings entry ${entry.id}.`);
      return { entry, transaction };
    }).sort((left, right) => right.entry.occurredAt.localeCompare(left.entry.occurredAt));
    return { ...summary, history };
  }

  async contribute(goalId: string, input: SavingsGoalMovementInput): Promise<Transaction> {
    return this.recordMovement(goalId, input, 'contribution');
  }

  async withdraw(goalId: string, input: SavingsGoalMovementInput): Promise<Transaction> {
    return this.recordMovement(goalId, input, 'withdrawal');
  }

  private async recordMovement(
    goalId: string,
    input: SavingsGoalMovementInput,
    direction: 'contribution' | 'withdrawal',
  ): Promise<Transaction> {
    this.validateMovement(input);
    const transactionId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const ledgerEntryId = crypto.randomUUID();

    return this.database.transaction(
      'rw',
      [
        this.database.savingsGoals,
        this.database.savingsGoalEntries,
        this.database.accounts,
        this.database.settings,
        this.database.transactions,
        this.database.ledgerEntries,
      ],
      async () => {
        const [goal, account, setting] = await Promise.all([
          this.database.savingsGoals.get(goalId),
          this.database.accounts.get(input.accountId),
          this.database.settings.get(ALLOW_NEGATIVE_SETTING),
        ]);
        if (!goal) throw new Error('Savings goal not found.');
        if (goal.status === 'archived') throw new Error('Archived savings goals cannot have new movements.');
        if (!account) throw new Error('Select an existing account.');
        this.assertActiveAccount(account, input.occurredAt);
        const current = await this.currentSaved(goalId);
        if (direction === 'withdrawal' && input.amountPaise > current) {
          throw new Error('Withdrawal cannot exceed the amount currently saved.');
        }
        const accountEntries = await this.database.ledgerEntries.where('accountId').equals(account.id).toArray();
        const balance = this.calculateBalance(account, accountEntries);
        const signedLedgerAmount = direction === 'contribution' ? -input.amountPaise : input.amountPaise;
        const nextBalance = balance + signedLedgerAmount;
        if (!Number.isSafeInteger(nextBalance)) {
          throw new RangeError('Account balance exceeds safe integer precision.');
        }
        if (direction === 'contribution' && setting?.value !== 'true' && nextBalance < 0) {
          throw new Error('Contribution amount exceeds the available balance.');
        }
        const nextSaved = current + (direction === 'contribution' ? input.amountPaise : -input.amountPaise);
        if (!Number.isSafeInteger(nextSaved) || nextSaved < 0) {
          throw new RangeError('Savings goal balance exceeds safe integer precision.');
        }

        const now = new Date().toISOString();
        const transaction: Transaction = {
          id: transactionId,
          type: direction === 'contribution' ? 'savings-contribution' : 'savings-withdrawal',
          amountPaise: input.amountPaise,
          occurredAt: input.occurredAt,
          description: input.notes?.trim() ||
            `Savings ${direction} · ${goal.name}`,
          notes: input.notes?.trim() || undefined,
          accountId: account.id,
          savingsGoalId: goalId,
          createdAt: now,
          updatedAt: now,
        };
        const entry: SavingsGoalEntry = {
          id: entryId,
          goalId,
          transactionId,
          accountId: account.id,
          occurredAt: input.occurredAt,
          amountPaise: direction === 'contribution' ? input.amountPaise : -input.amountPaise,
        };
        const ledgerEntry: LedgerEntry = {
          id: ledgerEntryId,
          transactionId,
          accountId: account.id,
          occurredAt: input.occurredAt,
          amountPaise: signedLedgerAmount,
        };
        await this.database.transactions.add(transaction);
        await this.database.ledgerEntries.add(ledgerEntry);
        await this.database.savingsGoalEntries.add(entry);
        await this.database.savingsGoals.update(goalId, {
          status: nextSaved >= goal.targetAmountPaise ? 'completed' : 'active',
          updatedAt: now,
        });
        return transaction;
      },
    );
  }

  private async progress(goal: SavingsGoal): Promise<SavingsGoalProgress> {
    const savedPaise = await this.currentSaved(goal.id);
    return {
      goal: {
        ...goal,
        status: goal.status === 'archived'
          ? 'archived'
          : savedPaise >= goal.targetAmountPaise
            ? 'completed'
            : 'active',
      },
      savedPaise,
      percentComplete: (savedPaise / goal.targetAmountPaise) * 100,
      remainingPaise: Math.max(0, goal.targetAmountPaise - savedPaise),
    };
  }

  private async currentSaved(goalId: string): Promise<number> {
    const entries = await this.database.savingsGoalEntries.where('goalId').equals(goalId).toArray();
    return entries.reduce((total, entry) => {
      if (!Number.isSafeInteger(entry.amountPaise)) throw new Error('Invalid savings goal entry amount.');
      const next = total + entry.amountPaise;
      if (!Number.isSafeInteger(next)) throw new RangeError('Savings goal balance exceeds safe integer precision.');
      return next;
    }, 0);
  }

  private async validateInput(input: SavingsGoalInput): Promise<void> {
    if (!input.name.trim()) throw new Error('Savings goal name cannot be empty.');
    if (input.name.trim().length > 100) throw new Error('Savings goal name must be 100 characters or fewer.');
    if (!Number.isSafeInteger(input.targetAmountPaise) || input.targetAmountPaise <= 0) {
      throw new Error('Target amount must be a positive amount in paise.');
    }
    if (input.targetDate && !isDateOnly(input.targetDate)) throw new Error('Enter a valid target date.');
    if (input.linkedAccountId) {
      const account = await this.database.accounts.get(input.linkedAccountId);
      if (!account) throw new Error('Select an existing linked account.');
    }
  }

  private validateMovement(input: SavingsGoalMovementInput): void {
    if (!input.accountId) throw new Error('Select an account.');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error('Movement amount must be a positive amount in paise.');
    }
    if (!isDateOnly(input.occurredAt.slice(0, 10))) throw new Error('Enter a valid movement date.');
    if (input.occurredAt.length !== 10 && !Number.isFinite(Date.parse(input.occurredAt))) {
      throw new Error('Enter a valid movement date.');
    }
  }

  private assertActiveAccount(account: Account, occurredAt: string): void {
    if (account.status !== 'active') throw new Error('Archived accounts cannot be used for new savings movements.');
    if (occurredAt.slice(0, 10) < account.openingDate) {
      throw new Error('Movement date cannot be before the account opening date.');
    }
  }

  private calculateBalance(account: Account, entries: LedgerEntry[]): number {
    return entries.reduce((balance, entry) => {
      if (!Number.isSafeInteger(entry.amountPaise)) throw new Error('Invalid ledger entry amount.');
      const next = balance + entry.amountPaise;
      if (!Number.isSafeInteger(next)) throw new RangeError('Account balance exceeds safe integer precision.');
      return next;
    }, account.openingBalancePaise);
  }
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
