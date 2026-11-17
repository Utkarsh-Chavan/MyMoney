import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideArchive, LucideArrowDownLeft, LucideArrowLeft, LucideArrowUpRight, LucidePencil } from '@lucide/angular';
import type { Account } from '../../core/models/finance.models';
import { AccountsService } from '../../core/services/accounts.service';
import { SavingsGoalsService, type SavingsGoalDetails } from '../../core/services/savings-goals.service';
import { formatPaise, formatStoredDate, localDateInputValue, parseRupeesToPaise } from '../../core/utilities/money';

@Component({
  selector: 'app-savings-goal-details',
  imports: [DecimalPipe, UpperCasePipe, ReactiveFormsModule, RouterLink, LucideArchive, LucideArrowDownLeft, LucideArrowLeft, LucideArrowUpRight, LucidePencil],
  templateUrl: './savings-goal-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsGoalDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly goalsService = inject(SavingsGoalsService);
  private readonly accountsService = inject(AccountsService);
  readonly goalId = this.route.snapshot.paramMap.get('goalId') ?? '';
  readonly details = signal<SavingsGoalDetails | null>(null);
  readonly accounts = signal<Account[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly archiving = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    amount: ['', Validators.required],
    accountId: ['', Validators.required],
    occurredAt: [localDateInputValue(), Validators.required],
    notes: ['', Validators.maxLength(2000)],
  });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [details, accounts] = await Promise.all([
        this.goalsService.getDetails(this.goalId),
        this.accountsService.listAccounts(),
      ]);
      if (!details) throw new Error('Savings goal not found.');
      this.details.set(details);
      this.accounts.set(accounts);
      if (!this.form.controls.accountId.value) {
        this.form.controls.accountId.setValue(
          details.goal.linkedAccountId ?? accounts.find(({ status }) => status === 'active')?.id ?? '',
        );
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this goal.');
    } finally { this.loading.set(false); }
  }

  async move(direction: 'contribution' | 'withdrawal'): Promise<void> {
    this.error.set('');
    this.success.set('');
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const details = this.details();
    if (!details) return;
    const values = this.form.getRawValue();
    const amountPaise = parseRupeesToPaise(values.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter a valid movement amount greater than zero.');
      return;
    }
    this.saving.set(true);
    try {
      const input = {
        amountPaise,
        accountId: values.accountId,
        occurredAt: values.occurredAt,
        notes: values.notes,
      };
      if (direction === 'contribution') await this.goalsService.contribute(this.goalId, input);
      else await this.goalsService.withdraw(this.goalId, input);
      this.success.set(`${direction === 'contribution' ? 'Contribution' : 'Withdrawal'} recorded.`);
      this.form.patchValue({ amount: '', notes: '', occurredAt: localDateInputValue() });
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to record this movement.');
    } finally { this.saving.set(false); }
  }

  async archive(): Promise<void> {
    const goal = this.details()?.goal;
    if (!goal || goal.status !== 'completed' ||
      !window.confirm(`Archive “${goal.name}”? Its contribution history will be preserved.`)) return;
    this.error.set('');
    this.archiving.set(true);
    try {
      await this.goalsService.archive(goal.id);
      this.success.set('Savings goal archived. Its history remains available.');
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to archive this goal.');
    } finally { this.archiving.set(false); }
  }

  accountName(id: string): string {
    return this.accounts().find(({ id: accountId }) => accountId === id)?.name ?? 'Account unavailable';
  }

  amount = formatPaise;
  date = formatStoredDate;
  percentage(value: number): number { return Math.min(value, 100); }
}
