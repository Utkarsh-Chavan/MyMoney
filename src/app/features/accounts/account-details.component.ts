import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { LucideArchive, LucideArrowLeft, LucideArrowLeftRight, LucidePencil } from '@lucide/angular';
import { AccountBalanceService, type AccountBalanceSummary, type AccountHistoryItem } from '../../core/services/account-balance.service';
import { AccountsService } from '../../core/services/accounts.service';
import { formatPaise } from '../../core/utilities/money';
import { accountTypeLabel } from './account-labels';

@Component({
  selector: 'app-account-details',
  imports: [RouterLink, LucideArchive, LucideArrowLeft, LucideArrowLeftRight, LucidePencil],
  templateUrl: './account-details.component.html',
})
export class AccountDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly balanceService = inject(AccountBalanceService);

  readonly accountId = this.route.snapshot.paramMap.get('accountId') ?? '';
  readonly summary = signal<AccountBalanceSummary | null>(null);
  readonly history = signal<AccountHistoryItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly filterError = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.filterError.set('');
    if (this.fromDate() && this.toDate() && this.fromDate() > this.toDate()) {
      this.filterError.set('Start date must be on or before end date.');
      this.loading.set(false);
      return;
    }

    try {
      const filter = { fromDate: this.fromDate() || undefined, toDate: this.toDate() || undefined };
      const [summary, history] = await Promise.all([
        this.balanceService.getSummary(this.accountId, filter),
        this.balanceService.getHistory(this.accountId, filter),
      ]);
      this.summary.set(summary);
      this.history.set(history);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load account details.');
    } finally {
      this.loading.set(false);
    }
  }

  async archive(): Promise<void> {
    const account = this.summary()?.account;
    if (!account || !window.confirm(`Archive ${account.name}? Its history will remain available.`)) return;
    this.error.set('');
    try {
      await this.accountsService.archiveAccount(account.id);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to archive this account.');
    }
  }

  updateFromDate(event: Event): void {
    this.fromDate.set((event.target as HTMLInputElement).value);
  }

  updateToDate(event: Event): void {
    this.toDate.set((event.target as HTMLInputElement).value);
  }

  formatMoney = formatPaise;
  typeLabel = accountTypeLabel;

  transactionType(type: string): string {
    return type === 'transfer' ? 'Account transfer' : type.replaceAll('-', ' ');
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  clearFilters(): void {
    this.fromDate.set('');
    this.toDate.set('');
    void this.load();
  }
}
