import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideArrowLeftRight, LucideCircleCheck } from '@lucide/angular';
import type { AccountBalanceSummary } from '../../core/services/account-balance.service';
import { AccountBalanceService } from '../../core/services/account-balance.service';
import { AccountTransfersService } from '../../core/services/account-transfers.service';
import { AccountsService } from '../../core/services/accounts.service';
import { formatPaise, localDateInputValue, parseRupeesToPaise } from '../../core/utilities/money';

@Component({
  selector: 'app-account-transfer',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideArrowLeftRight, LucideCircleCheck],
  templateUrl: './account-transfer.component.html',
})
export class AccountTransferComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly balanceService = inject(AccountBalanceService);
  private readonly transfersService = inject(AccountTransfersService);

  readonly accounts = signal<AccountBalanceSummary[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly allowNegativeBalances = signal(false);
  readonly today = localDateInputValue();

  fromAccountId = '';
  toAccountId = '';
  amount = '';
  occurredAt = this.today;
  description = '';

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const activeAccounts = await this.accountsService.listAccounts('active');
      const summaries = await Promise.all(activeAccounts.map(({ id }) => this.balanceService.getSummary(id)));
      this.accounts.set(summaries);
      const requestedSource = this.route.snapshot.queryParamMap.get('from');
      if (requestedSource && summaries.some(({ account }) => account.id === requestedSource)) {
        this.fromAccountId = requestedSource;
      }
      this.allowNegativeBalances.set(await this.transfersService.getAllowNegativeBalances());
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.error.set('');
    this.success.set('');
    const amountPaise = parseRupeesToPaise(this.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter a transfer amount greater than zero with no more than two decimal places.');
      return;
    }

    this.saving.set(true);
    try {
      const transfer = await this.transfersService.createTransfer({
        fromAccountId: this.fromAccountId,
        toAccountId: this.toAccountId,
        amountPaise,
        occurredAt: `${this.occurredAt}T12:00:00.000Z`,
        description: this.description,
      });
      this.success.set(`Transfer of ${formatPaise(transfer.amountPaise)} recorded.`);
      this.amount = '';
      this.description = '';
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  async updateNegativeBalancePreference(allow: boolean): Promise<void> {
    const previous = !allow;
    this.error.set('');
    try {
      await this.transfersService.setAllowNegativeBalances(allow);
      this.allowNegativeBalances.set(allow);
    } catch (error) {
      this.allowNegativeBalances.set(previous);
      this.error.set(this.errorMessage(error));
    }
  }

  selectedSource(): AccountBalanceSummary | undefined {
    return this.accounts().find(({ account }) => account.id === this.fromAccountId);
  }

  formatMoney = formatPaise;

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to save this transfer.';
  }
}
