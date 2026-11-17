import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck } from '@lucide/angular';
import type { BudgetAlertThreshold, BudgetPeriod, Category } from '../../core/models/finance.models';
import {
  BudgetsService,
  DEFAULT_BUDGET_ALERT_THRESHOLDS,
  type BudgetInput,
} from '../../core/services/budgets.service';
import { CategoriesService } from '../../core/services/categories.service';
import { localDateInputValue, parseRupeesToPaise, paiseToRupeesInput } from '../../core/utilities/money';

@Component({
  selector: 'app-budget-form',
  imports: [ReactiveFormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck],
  templateUrl: './budget-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);

  readonly id = this.route.snapshot.paramMap.get('budgetId');
  readonly editing = signal(!!this.id);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly categories = signal<Category[]>([]);
  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    categoryId: [''],
    alertThresholds: this.formBuilder.nonNullable.control<BudgetAlertThreshold[]>(
      [...DEFAULT_BUDGET_ALERT_THRESHOLDS],
    ),
    amount: ['', Validators.required],
    period: ['monthly' as BudgetPeriod, Validators.required],
    customPeriodDays: [30],
    startsOn: [localDateInputValue(), Validators.required],
    endsOn: [''],
  });

  ngOnInit(): void { void this.initialize(); }

  async initialize(): Promise<void> {
    try {
      const [categories, budget] = await Promise.all([
        this.categoriesService.list(),
        this.id ? this.budgetsService.get(this.id) : Promise.resolve(undefined),
      ]);
      this.categories.set(categories.filter((category) =>
        category.appliesTo === 'expense' &&
        (category.status === 'active' || category.id === budget?.categoryId)));
      if (this.id && !budget) throw new Error('Budget not found.');
      if (budget) {
        this.form.patchValue({
          name: budget.name,
          categoryId: budget.categoryId,
          alertThresholds: [...(budget.alertThresholds ?? DEFAULT_BUDGET_ALERT_THRESHOLDS)],
          amount: paiseToRupeesInput(budget.amountPaise),
          period: budget.period,
          customPeriodDays: budget.customPeriodDays ?? 30,
          startsOn: budget.startsOn,
          endsOn: budget.endsOn ?? '',
        });
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load the budget form.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.error.set('');
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const values = this.form.getRawValue();
    const amountPaise = parseRupeesToPaise(values.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter a valid budget amount greater than zero.');
      return;
    }
    const input: BudgetInput = {
      ...values,
      amountPaise,
      customPeriodDays: values.period === 'custom' ? Number(values.customPeriodDays) : undefined,
      endsOn: values.endsOn || undefined,
    };
    this.saving.set(true);
    try {
      if (this.id) await this.budgetsService.update(this.id, input);
      else await this.budgetsService.create(input);
      await this.router.navigate(['/budgets']);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to save this budget.');
    } finally {
      this.saving.set(false);
    }
  }

  toggleThreshold(threshold: BudgetAlertThreshold, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const current = this.form.controls.alertThresholds.value;
    this.form.controls.alertThresholds.setValue(
      target.checked
        ? [...new Set([...current, threshold])].sort((left, right) => left - right)
        : current.filter((value) => value !== threshold),
    );
  }

  readonly thresholdOptions = DEFAULT_BUDGET_ALERT_THRESHOLDS;
}
