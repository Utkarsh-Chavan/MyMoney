import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type {
  Budget,
  BudgetAlert,
  BudgetAlertThreshold,
  BudgetPeriod,
  Category,
  Transaction,
} from '../models/finance.models';
import { localDateInputValue } from '../utilities/money';

export interface BudgetInput {
  name: string;
  categoryId?: string;
  alertThresholds?: BudgetAlertThreshold[];
  amountPaise: number;
  period: BudgetPeriod;
  customPeriodDays?: number;
  startsOn: string;
  endsOn?: string;
}

export interface BudgetSummary {
  budget: Budget;
  spentPaise: number;
  percentUsed: number;
  remainingPaise: number;
  periodStart?: string;
  periodEnd?: string;
  alerts: BudgetAlert[];
}

export const DEFAULT_BUDGET_ALERT_THRESHOLDS: readonly BudgetAlertThreshold[] = [50, 75, 90, 100];

@Injectable({ providedIn: 'root' })
export class BudgetsService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async create(input: BudgetInput): Promise<Budget> {
    const category = await this.validateInput(input);
    if (category && category.status !== 'active') throw new Error('Archived categories cannot be used for new budgets.');
    const now = new Date().toISOString();
    const budget = this.normalizeInput(input, crypto.randomUUID(), now, now);
    await this.database.budgets.add(budget);
    return budget;
  }

  async update(id: string, input: BudgetInput): Promise<Budget> {
    const category = await this.validateInput(input);
    const existing = await this.database.budgets.get(id);
    if (!existing) throw new Error('Budget not found.');
    if (existing.archivedAt) throw new Error('Archived budgets cannot be edited.');
    if (category && category.status !== 'active' && category.id !== existing.categoryId) {
      throw new Error('Archived categories cannot be used for new budgets.');
    }
    const updated = this.normalizeInput(input, id, existing.createdAt, new Date().toISOString());
    await this.database.budgets.put(updated);
    return updated;
  }

  async archive(id: string): Promise<void> {
    const budget = await this.database.budgets.get(id);
    if (!budget) throw new Error('Budget not found.');
    if (budget.archivedAt) return;
    await this.database.budgets.update(id, {
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async get(id: string): Promise<Budget | undefined> {
    return this.database.budgets.get(id);
  }

  async list(date = localDateInputValue()): Promise<BudgetSummary[]> {
    if (!isDateOnly(date)) throw new Error('Enter a valid budget date.');
    const budgets = await this.database.budgets.orderBy('createdAt').reverse().toArray();
    const expenses = await this.database.transactions.where('type').equals('expense').toArray();
    const summaries = budgets.map((budget) => this.summarize(budget, date, expenses));
    const eligible = summaries.filter((summary) => summary.periodStart && !summary.budget.archivedAt);

    await this.database.transaction('rw', this.database.budgetAlerts, async () => {
      for (const summary of eligible) {
        const periodStart = summary.periodStart!;
        const thresholds = summary.budget.alertThresholds ?? DEFAULT_BUDGET_ALERT_THRESHOLDS;
        for (const threshold of thresholds) {
          if (summary.percentUsed < threshold) continue;
          const id = this.alertId(summary.budget.id, periodStart, threshold);
          if (await this.database.budgetAlerts.get(id)) continue;
          await this.database.budgetAlerts.add({
            id,
            budgetId: summary.budget.id,
            periodStart,
            thresholdPercent: threshold,
            spentPaise: summary.spentPaise,
            budgetAmountPaise: summary.budget.amountPaise,
            createdAt: new Date().toISOString(),
          });
        }
        summary.alerts = await this.database.budgetAlerts
          .where('[budgetId+periodStart]')
          .equals([summary.budget.id, periodStart])
          .filter((alert) => thresholds.includes(alert.thresholdPercent))
          .toArray();
        summary.alerts.sort((left, right) => left.thresholdPercent - right.thresholdPercent);
      }
    });

    return summaries;
  }

  async getAlerts(budgetId?: string): Promise<BudgetAlert[]> {
    const alerts = budgetId
      ? await this.database.budgetAlerts.where('budgetId').equals(budgetId).toArray()
      : await this.database.budgetAlerts.toArray();
    return alerts.sort(
      (left, right) => right.periodStart.localeCompare(left.periodStart) ||
        right.thresholdPercent - left.thresholdPercent,
    );
  }

  private summarize(budget: Budget, date: string, expenses: Transaction[]): BudgetSummary {
    const period = budget.archivedAt ? undefined : getBudgetPeriod(budget, date);
    if (!period) {
      return {
        budget,
        spentPaise: 0,
        percentUsed: 0,
        remainingPaise: budget.amountPaise,
        alerts: [],
      };
    }
    const spentPaise = expenses.reduce((total, transaction) => {
      if (transaction.voidedAt || (budget.categoryId && transaction.categoryId !== budget.categoryId)) return total;
      const occurredOn = transaction.occurredAt.slice(0, 10);
      if (occurredOn < period.start || occurredOn > period.end) return total;
      const next = total + transaction.amountPaise;
      if (!Number.isSafeInteger(next)) throw new RangeError('Budget spending exceeds safe integer precision.');
      return next;
    }, 0);
    return {
      budget,
      spentPaise,
      percentUsed: (spentPaise / budget.amountPaise) * 100,
      remainingPaise: budget.amountPaise - spentPaise,
      periodStart: period.start,
      periodEnd: period.end,
      alerts: [],
    };
  }

  private async validateInput(input: BudgetInput): Promise<Category | undefined> {
    const name = input.name.trim();
    if (!name) throw new Error('Budget name cannot be empty.');
    if (name.length > 80) throw new Error('Budget name must be 80 characters or fewer.');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new Error('Budget amount must be a positive amount in paise.');
    }
    if (!isDateOnly(input.startsOn) || (input.endsOn && !isDateOnly(input.endsOn))) {
      throw new Error('Enter valid budget dates.');
    }
    if (input.endsOn && input.endsOn < input.startsOn) {
      throw new Error('Budget end date cannot be before its start date.');
    }
    if (!['weekly', 'monthly', 'custom', 'yearly'].includes(input.period)) {
      throw new Error('Choose a supported budget period.');
    }
    const thresholds = input.alertThresholds ?? DEFAULT_BUDGET_ALERT_THRESHOLDS;
    if (thresholds.some((threshold) => !DEFAULT_BUDGET_ALERT_THRESHOLDS.includes(threshold)) ||
      new Set(thresholds).size !== thresholds.length) {
      throw new Error('Choose unique supported alert thresholds.');
    }
    if (input.period === 'custom' &&
      (!Number.isSafeInteger(input.customPeriodDays) || (input.customPeriodDays ?? 0) < 1 || (input.customPeriodDays ?? 0) > 3660)) {
      throw new Error('Custom budget periods must be between 1 and 3660 days.');
    }
    if (!input.categoryId) {
      if (input.period !== 'monthly') {
        throw new Error('Overall budgets must use the monthly period.');
      }
      return undefined;
    }
    const category = await this.database.categories.get(input.categoryId);
    if (!category || category.appliesTo !== 'expense') {
      throw new Error('Budgets must use an expense category.');
    }
    return category;
  }

  private normalizeInput(input: BudgetInput, id: string, createdAt: string, updatedAt: string): Budget {
    return {
      id,
      name: input.name.trim(),
      categoryId: input.categoryId,
      alertThresholds: [...(input.alertThresholds ?? DEFAULT_BUDGET_ALERT_THRESHOLDS)],
      amountPaise: input.amountPaise,
      period: input.period,
      customPeriodDays: input.period === 'custom' ? input.customPeriodDays : undefined,
      startsOn: input.startsOn,
      endsOn: input.endsOn || undefined,
      createdAt,
      updatedAt,
    };
  }

  private alertId(budgetId: string, periodStart: string, threshold: number): string {
    return `${budgetId}:${periodStart}:${threshold}`;
  }
}

export function getBudgetPeriod(
  budget: Pick<Budget, 'period' | 'startsOn' | 'endsOn' | 'customPeriodDays'>,
  date: string,
): { start: string; end: string } | undefined {
  if (!isDateOnly(date) || !isDateOnly(budget.startsOn) || date < budget.startsOn) return undefined;
  if (budget.endsOn && date > budget.endsOn) return undefined;

  let start: string;
  let end: string;
  if (budget.period === 'weekly' || budget.period === 'custom') {
    const length = budget.period === 'weekly' ? 7 : budget.customPeriodDays;
    if (!Number.isSafeInteger(length) || !length || length < 1) return undefined;
    const elapsed = daysBetween(budget.startsOn, date);
    const periodIndex = Math.floor(elapsed / length);
    start = addDays(budget.startsOn, periodIndex * length);
    end = addDays(start, length - 1);
  } else if (budget.period === 'monthly') {
    const monthIndex = monthDifference(budget.startsOn, date);
    let periodIndex = monthIndex;
    start = addMonthsClamped(budget.startsOn, periodIndex);
    if (start > date) {
      periodIndex -= 1;
      start = addMonthsClamped(budget.startsOn, periodIndex);
    }
    end = addDays(addMonthsClamped(budget.startsOn, periodIndex + 1), -1);
  } else {
    const yearIndex = Number(date.slice(0, 4)) - Number(budget.startsOn.slice(0, 4));
    let periodIndex = yearIndex;
    start = addYearsClamped(budget.startsOn, periodIndex);
    if (start > date) {
      periodIndex -= 1;
      start = addYearsClamped(budget.startsOn, periodIndex);
    }
    end = addDays(addYearsClamped(budget.startsOn, periodIndex + 1), -1);
  }
  if (budget.endsOn && end > budget.endsOn) end = budget.endsOn;
  return { start, end };
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthDifference(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

function addMonthsClamped(anchor: string, months: number): string {
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7)) - 1 + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Number(anchor.slice(8, 10));
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function addYearsClamped(anchor: string, years: number): string {
  const year = Number(anchor.slice(0, 4)) + years;
  const month = Number(anchor.slice(5, 7)) - 1;
  const day = Number(anchor.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
