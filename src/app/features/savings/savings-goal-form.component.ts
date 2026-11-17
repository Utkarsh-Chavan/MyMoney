import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck } from '@lucide/angular';
import { SavingsGoalsService, type SavingsGoalInput } from '../../core/services/savings-goals.service';
import { localDateInputValue, parseRupeesToPaise, paiseToRupeesInput } from '../../core/utilities/money';

@Component({
  selector: 'app-savings-goal-form',
  imports: [ReactiveFormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck],
  templateUrl: './savings-goal-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsGoalFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly goalsService = inject(SavingsGoalsService);
  readonly id = this.route.snapshot.paramMap.get('goalId');
  readonly editing = signal(!!this.id);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    targetAmount: ['', Validators.required],
    targetDate: [''],
    notes: ['', Validators.maxLength(2000)],
  });

  ngOnInit(): void { void this.initialize(); }

  async initialize(): Promise<void> {
    try {
      if (this.id) {
        const goal = await this.goalsService.getDetails(this.id);
        if (!goal) throw new Error('Savings goal not found.');
        this.form.patchValue({
          name: goal.goal.name,
          targetAmount: paiseToRupeesInput(goal.goal.targetAmountPaise),
          targetDate: goal.goal.targetDate ?? '',
          notes: goal.goal.notes ?? '',
        });
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this savings goal.');
    } finally { this.loading.set(false); }
  }

  async save(): Promise<void> {
    this.error.set('');
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const values = this.form.getRawValue();
    const targetAmountPaise = parseRupeesToPaise(values.targetAmount);
    if (targetAmountPaise === null || targetAmountPaise <= 0) {
      this.error.set('Enter a valid target amount greater than zero.');
      return;
    }
    const input: SavingsGoalInput = {
      name: values.name,
      targetAmountPaise,
      targetDate: values.targetDate || undefined,
      notes: values.notes,
    };
    this.saving.set(true);
    try {
      const goal = this.id
        ? await this.goalsService.update(this.id, input)
        : await this.goalsService.create(input);
      await this.router.navigate(['/savings', goal.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to save this goal.');
    } finally { this.saving.set(false); }
  }

  readonly today = localDateInputValue();
}
