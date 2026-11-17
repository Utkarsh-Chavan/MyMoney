import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowDownRight,
  LucideArrowLeftRight,
  LucideArrowRight,
  LucideArrowUpRight,
  LucideLandmark,
  LucidePlus,
  LucideWallet,
} from '@lucide/angular';
import { DecimalPipe } from '@angular/common';
import type { Account, Category, Transaction } from '../../core/models/finance.models';
import { AccountBalanceService } from '../../core/services/account-balance.service';
import { AccountsService } from '../../core/services/accounts.service';
import { CategoriesService } from '../../core/services/categories.service';
import { LoansService, type LoanDashboardSummary } from '../../core/services/loans.service';
import { BudgetsService, type BudgetSummary } from '../../core/services/budgets.service';
import { SavingsGoalsService, type SavingsGoalProgress } from '../../core/services/savings-goals.service';
import { TransactionsService, type TransactionFilters } from '../../core/services/transactions.service';
import { formatPaise, formatStoredDate, localDateInputValue } from '../../core/utilities/money';
import { accountTypeLabel } from '../accounts/account-labels';
import { transactionTypeLabel } from '../transactions/transaction-labels';

interface DashboardAccount {
  account: Account;
  currentBalancePaise: number;
}

interface WeeklySpend {
  date: string;
  label: string;
  amountPaise: number;
}

interface CategorySpend {
  id: string;
  name: string;
  amountPaise: number;
  sharePercent: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    DecimalPipe,
    LucideArrowDownRight,
    LucideArrowLeftRight,
    LucideArrowRight,
    LucideArrowUpRight,
    LucideLandmark,
    LucidePlus,
    LucideWallet,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly balanceService = inject(AccountBalanceService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly loansService = inject(LoansService);
  private readonly budgetsService = inject(BudgetsService);
  private readonly savingsGoalsService = inject(SavingsGoalsService);
  private readonly transactionsService = inject(TransactionsService);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly accounts = signal<DashboardAccount[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly recentTransactions = signal<Transaction[]>([]);
  readonly budgetSummaries = signal<BudgetSummary[]>([]);
  readonly savingsGoals = signal<SavingsGoalProgress[]>([]);
  readonly weeklySpending = signal<WeeklySpend[]>([]);
  readonly categorySpending = signal<CategorySpend[]>([]);
  readonly availableBalancePaise = signal(0);
  readonly monthlyIncomePaise = signal(0);
  readonly monthlyExpensePaise = signal(0);
  readonly outstandingLoans = signal<LoanDashboardSummary>({
    totalLentPaise: 0,
    totalBorrowedPaise: 0,
    receivablePaise: 0,
    payablePaise: 0,
    outstandingPaise: 0,
    outstandingCount: 0,
    settledCount: 0,
    partiallyRepaidCount: 0,
    overdueCount: 0,
    needsReviewCount: 0,
  });
  readonly hasWeeklySpending = computed(
    () => this.weeklySpending().some(({ amountPaise }) => amountPaise > 0),
  );
  readonly currentBudgets = computed(
    () => this.budgetSummaries()
      .filter(({ periodStart, budget }) => !!periodStart && !budget.archivedAt)
      .slice(0, 3),
  );
  readonly currentSavingsGoals = computed(
    () => this.savingsGoals().filter(({ goal }) => goal.status !== 'archived'),
  );
  readonly goalPreviews = computed(() => [...this.currentSavingsGoals()]
    .sort((left, right) => left.goal.status.localeCompare(right.goal.status))
    .slice(0, 3));
  readonly savingsTargetPaise = computed(
    () => this.sumSafe(this.currentSavingsGoals().map(({ goal }) => goal.targetAmountPaise)),
  );
  readonly savingsSavedPaise = computed(
    () => this.sumSafe(this.currentSavingsGoals().map(({ savedPaise }) => savedPaise)),
  );
  readonly completedGoalCount = computed(
    () => this.currentSavingsGoals().filter(({ goal }) => goal.status === 'completed').length,
  );
  readonly nextSavingsGoal = computed(() => this.currentSavingsGoals()
    .filter(({ goal }) => goal.status === 'active' && !!goal.targetDate && goal.targetDate >= localDateInputValue())
    .sort((left, right) => left.goal.targetDate!.localeCompare(right.goal.targetDate!))[0]);
  readonly weeklyTotalPaise = computed(
    () => this.sumSafe(this.weeklySpending().map(({ amountPaise }) => amountPaise)),
  );
  readonly activeAccountCount = computed(
    () => this.accounts().filter(({ account }) => account.status === 'active').length,
  );
  readonly todayLabel = formatStoredDate(localDateInputValue());
  readonly monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async loadDashboard(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const [accounts, categories, loanSummary, budgetSummaries, savingsGoals] = await Promise.all([
        this.accountsService.listAccounts(),
        this.categoriesService.list(),
        this.loansService.getDashboardSummary(),
        this.budgetsService.list(),
        this.savingsGoalsService.list(),
      ]);
      const accountSummaries = await Promise.all(
        accounts.map(async (account): Promise<DashboardAccount> => ({
          account,
          currentBalancePaise: await this.balanceService.getBalance(account.id),
        })),
      );
      const today = localDateInputValue();
      const monthStart = `${today.slice(0, 7)}-01`;
      const weekStart = this.weekStart(today);
      const [monthlyIncome, monthlyExpenses, weeklyExpenses, recent] = await Promise.all([
        this.loadTransactions({ type: 'income', fromDate: monthStart, toDate: today }),
        this.loadTransactions({ type: 'expense', fromDate: monthStart, toDate: today }),
        this.loadTransactions({ type: 'expense', fromDate: weekStart, toDate: today }),
        this.transactionsService.list({ page: 1, pageSize: 5, sort: 'newest' }),
      ]);

      this.accounts.set(accountSummaries);
      this.categories.set(categories);
      this.availableBalancePaise.set(
        this.sumSafe(
          accountSummaries
            .filter(({ account }) => account.status === 'active')
            .map(({ currentBalancePaise }) => currentBalancePaise),
        ),
      );
      this.monthlyIncomePaise.set(this.sumTransactions(monthlyIncome));
      this.monthlyExpensePaise.set(this.sumTransactions(monthlyExpenses));
      this.weeklySpending.set(this.buildWeeklySpending(weeklyExpenses, weekStart));
      this.categorySpending.set(this.buildCategorySpending(monthlyExpenses, categories));
      this.recentTransactions.set(recent.items);
      this.outstandingLoans.set(loanSummary);
      this.budgetSummaries.set(budgetSummaries);
      this.savingsGoals.set(savingsGoals);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  accountTypeLabel = accountTypeLabel;
  transactionTypeLabel = transactionTypeLabel;
  formatMoney = formatPaise;
  formatDate = formatStoredDate;

  accountName(transaction: Transaction): string {
    if (transaction.type === 'transfer') {
      const from = this.accounts().find(({ account }) => account.id === transaction.fromAccountId)?.account.name;
      const to = this.accounts().find(({ account }) => account.id === transaction.toAccountId)?.account.name;
      return `${from ?? 'Unknown'} → ${to ?? 'Unknown'}`;
    }
    return this.accounts().find(({ account }) => account.id === transaction.accountId)?.account.name ?? 'Account';
  }

  categoryName(transaction: Transaction): string {
    return this.categories().find(({ id }) => id === transaction.categoryId)?.name ?? 'Uncategorized';
  }

  transactionAmount(transaction: Transaction): string {
    if (transaction.type === 'income') return `+${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'expense') return `-${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-contribution') return `−${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-withdrawal') return `+${formatPaise(transaction.amountPaise)}`;
    return formatPaise(transaction.amountPaise);
  }

  weekBarHeight(amountPaise: number): number {
    const maximum = Math.max(...this.weeklySpending().map(({ amountPaise: amount }) => amount), 0);
    return maximum === 0 ? 3 : Math.max(5, (amountPaise / maximum) * 100);
  }

  comparisonWidth(amountPaise: number): number {
    const maximum = Math.max(this.monthlyIncomePaise(), this.monthlyExpensePaise());
    return maximum === 0 ? 0 : (amountPaise / maximum) * 100;
  }

  private async loadTransactions(filters: TransactionFilters): Promise<Transaction[]> {
    const pageSize = 100;
    const result = await this.transactionsService.list({ ...filters, page: 1, pageSize });
    const transactions = [...result.items];

    for (let page = 2; transactions.length < result.totalItems; page += 1) {
      const next = await this.transactionsService.list({ ...filters, page, pageSize });
      transactions.push(...next.items);
    }

    return transactions;
  }

  private buildWeeklySpending(transactions: Transaction[], weekStart: string): WeeklySpend[] {
    const amountsByDate = new Map<string, number>();
    for (const transaction of transactions) {
      const date = transaction.occurredAt.slice(0, 10);
      amountsByDate.set(
        date,
        this.addSafe(amountsByDate.get(date) ?? 0, transaction.amountPaise),
      );
    }

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${weekStart}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const isoDate = date.toISOString().slice(0, 10);
      return {
        date: isoDate,
        label: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(date),
        amountPaise: amountsByDate.get(isoDate) ?? 0,
      };
    });
  }

  private buildCategorySpending(
    transactions: Transaction[],
    categories: Category[],
  ): CategorySpend[] {
    const amountsByCategory = new Map<string, number>();
    for (const transaction of transactions) {
      const id = transaction.categoryId ?? 'uncategorized';
      amountsByCategory.set(
        id,
        this.addSafe(amountsByCategory.get(id) ?? 0, transaction.amountPaise),
      );
    }

    const sorted = [...amountsByCategory.entries()]
      .map(([id, amountPaise]) => ({
        id,
        name: categories.find((category) => category.id === id)?.name ?? 'Uncategorized',
        amountPaise,
      }))
      .sort((left, right) => right.amountPaise - left.amountPaise);
    const topCategories = sorted.slice(0, 5);
    const remainingPaise = this.sumSafe(sorted.slice(5).map(({ amountPaise }) => amountPaise));
    if (remainingPaise > 0) {
      topCategories.push({ id: 'other-categories', name: 'Other categories', amountPaise: remainingPaise });
    }

    const total = this.sumTransactions(transactions);
    return topCategories.map((category) => ({
      ...category,
      sharePercent: total === 0 ? 0 : (category.amountPaise / total) * 100,
    }));
  }

  private sumTransactions(transactions: Transaction[]): number {
    return this.sumSafe(transactions.map(({ amountPaise }) => amountPaise));
  }

  private sumSafe(values: number[]): number {
    return values.reduce((total, value) => this.addSafe(total, value), 0);
  }

  private addSafe(left: number, right: number): number {
    if (!Number.isSafeInteger(right)) throw new Error('Financial data contains an invalid amount.');
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError('Dashboard total exceeds safe integer precision.');
    return result;
  }

  private weekStart(today: string): string {
    const date = new Date(`${today}T00:00:00.000Z`);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return date.toISOString().slice(0, 10);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to load your financial overview.';
  }
}
