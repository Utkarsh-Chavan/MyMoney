import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucidePencil, LucideTrash2 } from '@lucide/angular';
import type { Account, LoanDirection } from '../../core/models/finance.models';
import { AccountsService } from '../../core/services/accounts.service';
import {
  LoansService,
  type LoanHistoryItem,
  type LoanStatus,
  type LoanSummary,
} from '../../core/services/loans.service';
import { formatPaise, formatStoredDate, localDateInputValue, parseRupeesToPaise } from '../../core/utilities/money';

@Component({
  selector: 'app-loan-details',
  imports: [ReactiveFormsModule, RouterLink, LucideArrowLeft, LucidePencil, LucideTrash2],
  templateUrl: './loan-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanDetailsComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loansService = inject(LoansService);
  private readonly accountsService = inject(AccountsService);

  readonly loanId = this.route.snapshot.paramMap.get('loanId') ?? '';
  readonly summary = signal<LoanSummary | null>(null);
  readonly history = signal<LoanHistoryItem[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly repaymentForm = this.formBuilder.nonNullable.group({
    amount: this.formBuilder.nonNullable.control('', Validators.required),
    accountId: this.formBuilder.nonNullable.control('', Validators.required),
    occurredAt: this.formBuilder.nonNullable.control(localDateInputValue(), Validators.required),
    notes: this.formBuilder.nonNullable.control(''),
  });
  readonly hasRepayments = computed(() =>
    this.history().some(({ entry }) => entry.outstandingChangePaise < 0),
  );
  readonly isManaged = computed(() => {
    const summary = this.summary();
    return !!summary && summary.status !== 'needs-review';
  });
  readonly canDelete = computed(() => this.isManaged() && !this.hasRepayments());

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [details, accounts] = await Promise.all([
        this.loansService.getDetails(this.loanId),
        this.accountsService.listAccounts(),
      ]);
      if (!details) throw new Error('Loan not found.');
      this.summary.set(details.summary);
      this.history.set(details.history);
      this.accounts.set(accounts);
      const activeAccount = accounts.find(({ status }) => status === 'active');
      const selectedAccountId = this.repaymentForm.controls.accountId.value;
      const selectedAccountIsActive = accounts.some(
        ({ id, status }) => id === selectedAccountId && status === 'active',
      );
      this.repaymentForm.patchValue({
        accountId: selectedAccountIsActive ? selectedAccountId : activeAccount?.id ?? '',
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load loan details.');
    } finally {
      this.loading.set(false);
    }
  }

  async recordRepayment(): Promise<void> {
    const summary = this.summary();
    if (!summary || !this.isManaged()) return;
    this.error.set('');
    if (this.repaymentForm.invalid) {
      this.repaymentForm.markAllAsTouched();
      this.error.set('Complete the required repayment details.');
      return;
    }
    const values = this.repaymentForm.getRawValue();
    const amountPaise = parseRupeesToPaise(values.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter a positive amount with no more than two decimal places.');
      return;
    }

    this.saving.set(true);
    try {
      await this.loansService.createRepayment(summary.loan.id, {
        amountPaise,
        accountId: values.accountId,
        occurredAt: values.occurredAt,
        notes: values.notes,
      });
      this.repaymentForm.reset({
        amount: '',
        accountId: values.accountId,
        occurredAt: localDateInputValue(),
        notes: '',
      });
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to record this repayment.');
    } finally {
      this.saving.set(false);
    }
  }

  async deleteLoan(): Promise<void> {
    const summary = this.summary();
    if (!summary || !this.canDelete()) return;
    if (!window.confirm('Delete this loan and its principal ledger entry? This cannot be undone.')) return;
    this.error.set('');
    try {
      await this.loansService.deleteLoan(summary.loan.id);
      await this.router.navigate(['/loans']);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to delete this loan.');
    }
  }

  personName(summary: LoanSummary): string {
    return summary.person?.name ??
      ('personName' in summary.loan && summary.loan.personName ? summary.loan.personName : 'Unknown person');
  }

  accountName(id: string | undefined): string {
    if (!id) return 'Account unavailable';
    return this.accounts().find(({ id: accountId }) => accountId === id)?.name ?? 'Account unavailable';
  }

  directionLabel(direction: LoanDirection): string {
    return direction === 'lent' ? 'Money lent · someone owes you' : 'Money borrowed · you owe someone';
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

  historyLabel(item: LoanHistoryItem): string {
    return item.entry.outstandingChangePaise > 0
      ? 'Original principal'
      : item.transaction.type === 'loan-repayment-received'
        ? 'Repayment received'
        : 'Repayment made';
  }

  historyAmount(item: LoanHistoryItem): string {
    const amount = Math.abs(item.entry.outstandingChangePaise);
    return `${item.entry.outstandingChangePaise > 0 ? '' : '−'}${formatPaise(amount)}`;
  }

  loanDate(summary: LoanSummary): string {
    const loan = summary.loan;
    return formatStoredDate('startedAt' in loan && loan.startedAt ? loan.startedAt : loan.createdAt);
  }

  dueDate(summary: LoanSummary): string {
    const dueDate = summary.loan.dueDate;
    return dueDate ? formatStoredDate(dueDate) : 'Not set';
  }

  amountLabel(amount: number | null): string {
    return amount === null ? 'Unavailable' : formatPaise(amount);
  }

  outstandingLabel(summary: LoanSummary): string {
    return summary.principalPaise === null ? 'Unavailable' : formatPaise(summary.outstandingPaise);
  }

  formatMoney = formatPaise;
  formatDate = formatStoredDate;
}
