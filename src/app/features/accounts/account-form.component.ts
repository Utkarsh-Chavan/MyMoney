import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck } from '@lucide/angular';
import type { AccountType } from '../../core/models/finance.models';
import { AccountsService, type AccountInput } from '../../core/services/accounts.service';
import { formatPaise, localDateInputValue, paiseToRupeesInput, parseRupeesToPaise } from '../../core/utilities/money';
import { accountTypeLabel } from './account-labels';

@Component({
  selector: 'app-account-form',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck],
  templateUrl: './account-form.component.html',
})
export class AccountFormComponent implements OnInit {
  private readonly accountsService = inject(AccountsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly accountId = this.route.snapshot.paramMap.get('accountId');
  readonly editing = signal(this.accountId !== null);
  readonly loading = signal(this.editing());
  readonly saving = signal(false);
  readonly hasActivity = signal(false);
  readonly error = signal('');
  readonly types: AccountType[] = ['savings-bank', 'current-bank', 'cash-wallet', 'digital-wallet', 'other'];
  readonly typeLabel = accountTypeLabel;

  name = '';
  type: AccountType = 'savings-bank';
  institution = '';
  openingBalance = '0.00';
  openingDate = localDateInputValue();

  ngOnInit(): void {
    if (this.accountId) void this.loadAccount(this.accountId);
  }

  async save(): Promise<void> {
    this.error.set('');
    const openingBalancePaise = parseRupeesToPaise(this.openingBalance);
    if (openingBalancePaise === null) {
      this.error.set('Enter a non-negative amount with no more than two decimal places.');
      return;
    }

    const input: AccountInput = {
      name: this.name,
      type: this.type,
      institution: this.institution,
      openingBalancePaise,
      openingDate: this.openingDate,
    };

    this.saving.set(true);
    try {
      const account = this.accountId
        ? await this.accountsService.updateAccount(this.accountId, input)
        : await this.accountsService.createAccount(input);
      await this.router.navigate(['/accounts', account.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to save this account.');
    } finally {
      this.saving.set(false);
    }
  }

  formatMoney = formatPaise;

  private async loadAccount(id: string): Promise<void> {
    this.error.set('');
    try {
      const account = await this.accountsService.getAccount(id);
      if (!account) throw new Error('Account not found.');
      this.name = account.name;
      this.type = account.type;
      this.institution = account.institution ?? '';
      this.openingBalance = paiseToRupeesInput(account.openingBalancePaise);
      this.openingDate = account.openingDate;
      this.hasActivity.set(await this.accountsService.hasLedgerHistory(id));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this account.');
    } finally {
      this.loading.set(false);
    }
  }
}
