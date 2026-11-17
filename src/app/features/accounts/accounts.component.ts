import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArchive, LucideArrowLeftRight, LucideLandmark, LucidePlus, LucideWallet } from '@lucide/angular';
import type { AccountStatus } from '../../core/models/finance.models';
import { AccountBalanceService, type AccountBalanceSummary } from '../../core/services/account-balance.service';
import { AccountsService } from '../../core/services/accounts.service';
import { formatPaise } from '../../core/utilities/money';
import { accountTypeLabel } from './account-labels';

@Component({
  selector: 'app-accounts',
  imports: [RouterLink, LucideArchive, LucideArrowLeftRight, LucideLandmark, LucidePlus, LucideWallet],
  templateUrl: './accounts.component.html',
})
export class AccountsComponent implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly balanceService = inject(AccountBalanceService);

  readonly accountSummaries = signal<AccountBalanceSummary[]>([]);
  readonly status = signal<AccountStatus>('active');
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    void this.loadAccounts();
  }

  async loadAccounts(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const accounts = await this.accountsService.listAccounts(this.status());
      const summaries = await Promise.all(accounts.map(({ id }) => this.balanceService.getSummary(id)));
      this.accountSummaries.set(summaries);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async setStatus(status: AccountStatus): Promise<void> {
    this.status.set(status);
    await this.loadAccounts();
  }

  async archiveAccount(accountId: string): Promise<void> {
    if (!window.confirm('Archive this account? Its history will remain available.')) return;
    this.error.set('');
    try {
      await this.accountsService.archiveAccount(accountId);
      await this.loadAccounts();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  formatMoney = formatPaise;
  typeLabel = accountTypeLabel;

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to load accounts. Please try again.';
  }
}
