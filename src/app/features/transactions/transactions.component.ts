import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideArrowDownRight,
  LucideArrowLeftRight,
  LucideArrowUpRight,
  LucideCalendarDays,
  LucideChevronLeft,
  LucideChevronRight,
  LucideFilter,
  LucidePlus,
  LucideSearch,
  LucideSlidersHorizontal,
} from '@lucide/angular';
import type { Account, Category, Transaction, TransactionType } from '../../core/models/finance.models';
import { CategoriesService } from '../../core/services/categories.service';
import { AccountsService } from '../../core/services/accounts.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { formatPaise, formatStoredDate } from '../../core/utilities/money';
import { transactionTypeLabel } from './transaction-labels';

@Component({
  selector: 'app-transactions',
  imports: [
    FormsModule,
    RouterLink,
    LucideArrowDownRight,
    LucideArrowLeftRight,
    LucideArrowUpRight,
    LucideCalendarDays,
    LucideChevronLeft,
    LucideChevronRight,
    LucideFilter,
    LucidePlus,
    LucideSearch,
    LucideSlidersHorizontal,
  ],
  templateUrl: './transactions.component.html',
})
export class TransactionsComponent implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);

  readonly transactions = signal<Transaction[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly totalItems = signal(0);
  readonly page = signal(1);
  readonly pageSize = 25;
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize)));
  readonly loading = signal(true);
  readonly error = signal('');

  search = '';
  accountId = '';
  categoryId = '';
  type: TransactionType | 'all' = 'all';
  fromDate = '';
  toDate = '';
  sort: 'newest' | 'oldest' = 'newest';

  ngOnInit(): void {
    void this.initialize();
  }

  async initialize(): Promise<void> {
    this.error.set('');
    try {
      const [accounts, categories] = await Promise.all([
        this.accountsService.listAccounts(),
        this.categoriesService.list(),
      ]);
      this.accounts.set(accounts);
      this.categories.set(categories);
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
      this.loading.set(false);
    }
  }

  async applyFilters(): Promise<void> {
    this.page.set(1);
    await this.load();
  }

  async changePage(page: number): Promise<void> {
    if (page < 1 || page > this.pageCount()) return;
    this.page.set(page);
    await this.load();
  }

  async clearFilters(): Promise<void> {
    this.search = '';
    this.accountId = '';
    this.categoryId = '';
    this.type = 'all';
    this.fromDate = '';
    this.toDate = '';
    this.sort = 'newest';
    this.page.set(1);
    await this.load();
  }

  accountLabel(transaction: Transaction): string {
    const accounts = this.accounts();
    if (transaction.type === 'transfer') {
      const from = accounts.find(({ id }) => id === transaction.fromAccountId)?.name ?? 'Unknown account';
      const to = accounts.find(({ id }) => id === transaction.toAccountId)?.name ?? 'Unknown account';
      return `${from} → ${to}`;
    }
    return accounts.find(({ id }) => id === transaction.accountId)?.name ?? 'Unknown account';
  }

  categoryLabel(transaction: Transaction): string {
    return this.categories().find(({ id }) => id === transaction.categoryId)?.name ?? '—';
  }

  amountLabel(transaction: Transaction): string {
    if (transaction.type === 'income') return `+${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'expense') return `-${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-contribution') return `−${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-withdrawal') return `+${formatPaise(transaction.amountPaise)}`;
    return formatPaise(transaction.amountPaise);
  }

  typeLabel = transactionTypeLabel;
  dateLabel = formatStoredDate;
  formatMoney = formatPaise;

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.transactionsService.list({
        search: this.search,
        accountId: this.accountId || undefined,
        categoryId: this.categoryId || undefined,
        type: this.type,
        fromDate: this.fromDate || undefined,
        toDate: this.toDate || undefined,
        sort: this.sort,
        page: this.page(),
        pageSize: this.pageSize,
      });
      this.transactions.set(result.items);
      this.totalItems.set(result.totalItems);
      this.page.set(result.page);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to load transaction history.';
  }
}
