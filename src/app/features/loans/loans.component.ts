import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideArrowDownRight, LucideArrowLeftRight, LucideArrowUpRight, LucidePlus } from '@lucide/angular';
import type { Account, LoanDirection, Person } from '../../core/models/finance.models';
import {
  LoansService,
  type LoanDashboardSummary,
  type LoanStatus,
  type LoanSummary,
} from '../../core/services/loans.service';
import { AccountsService } from '../../core/services/accounts.service';
import { formatPaise, formatStoredDate } from '../../core/utilities/money';

@Component({
  selector: 'app-loans',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    LucideArrowDownRight,
    LucideArrowLeftRight,
    LucideArrowUpRight,
    LucidePlus,
  ],
  templateUrl: './loans.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoansComponent implements OnInit {
  private readonly loansService = inject(LoansService);
  private readonly accountsService = inject(AccountsService);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly people = signal<Person[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly items = signal<LoanSummary[]>([]);
  readonly totalItems = signal(0);
  readonly page = signal(1);
  readonly pageSize = 25;
  readonly dashboard = signal<LoanDashboardSummary>({
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
  readonly filters = new FormGroup({
    personId: new FormControl('', { nonNullable: true }),
    direction: new FormControl<'all' | LoanDirection>('all', { nonNullable: true }),
    status: new FormControl<'all' | LoanStatus>('all', { nonNullable: true }),
    fromDate: new FormControl('', { nonNullable: true }),
    toDate: new FormControl('', { nonNullable: true }),
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize)));

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [people, accounts, dashboard, page] = await Promise.all([
        this.loansService.listPeople(),
        this.accountsService.listAccounts(),
        this.loansService.getDashboardSummary(),
        this.loansService.list({ page: this.page(), pageSize: this.pageSize }),
      ]);
      this.people.set(people);
      this.accounts.set(accounts);
      this.dashboard.set(dashboard);
      this.setPage(page);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load loans and debts.');
    } finally {
      this.loading.set(false);
    }
  }

  async applyFilters(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const values = this.filters.getRawValue();
      const result = await this.loansService.list({
        ...values,
        personId: values.personId || undefined,
        fromDate: values.fromDate || undefined,
        toDate: values.toDate || undefined,
        page: 1,
        pageSize: this.pageSize,
      });
      this.page.set(1);
      this.setPage(result);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to filter loan history.');
    } finally {
      this.loading.set(false);
    }
  }

  async changePage(nextPage: number): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const values = this.filters.getRawValue();
      const result = await this.loansService.list({
        ...values,
        personId: values.personId || undefined,
        fromDate: values.fromDate || undefined,
        toDate: values.toDate || undefined,
        page: nextPage,
        pageSize: this.pageSize,
      });
      this.setPage(result);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this page.');
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters(): void {
    this.filters.reset({
      personId: '',
      direction: 'all',
      status: 'all',
      fromDate: '',
      toDate: '',
    });
    void this.applyFilters();
  }

  personName(summary: LoanSummary): string {
    return summary.person?.name ??
      ('personName' in summary.loan && summary.loan.personName ? summary.loan.personName : 'Unknown person');
  }

  accountName(summary: LoanSummary): string {
    const accountId = 'accountId' in summary.loan ? summary.loan.accountId : undefined;
    return this.accounts().find(({ id }) => id === accountId)?.name ?? 'Account unavailable';
  }

  loanDate(summary: LoanSummary): string {
    const date = 'startedAt' in summary.loan && summary.loan.startedAt
      ? summary.loan.startedAt
      : summary.loan.createdAt;
    return formatStoredDate(date);
  }

  directionLabel(direction: LoanDirection): string {
    return direction === 'lent' ? 'Money lent' : 'Money borrowed';
  }

  statusLabel(status: LoanStatus): string {
    switch (status) {
      case 'open': return 'Open';
      case 'partially-repaid': return 'Partially repaid';
      case 'settled': return 'Settled';
      case 'overdue': return 'Overdue';
      case 'needs-review': return 'Needs review';
    }
  }

  amountLabel(amount: number | null): string {
    return amount === null ? 'Unavailable' : formatPaise(amount);
  }

  outstandingLabel(summary: LoanSummary): string {
    return summary.principalPaise === null ? 'Unavailable' : formatPaise(summary.outstandingPaise);
  }

  formatMoney = formatPaise;

  private setPage(result: { items: LoanSummary[]; totalItems: number; page: number }): void {
    this.items.set(result.items);
    this.totalItems.set(result.totalItems);
    this.page.set(result.page);
  }
}
