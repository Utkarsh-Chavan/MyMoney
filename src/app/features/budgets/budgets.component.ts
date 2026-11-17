import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArchive, LucideBell, LucidePlus, LucideReceipt } from '@lucide/angular';
import type { Category } from '../../core/models/finance.models';
import { BudgetsService, type BudgetSummary } from '../../core/services/budgets.service';
import { CategoriesService } from '../../core/services/categories.service';
import { formatPaise } from '../../core/utilities/money';

@Component({
  selector: 'app-budgets',
  imports: [RouterLink, LucideArchive, LucideBell, LucidePlus, LucideReceipt],
  templateUrl: './budgets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetsComponent implements OnInit {
  private readonly budgetsService = inject(BudgetsService);
  private readonly categoriesService = inject(CategoriesService);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly summaries = signal<BudgetSummary[]>([]);
  readonly categories = signal<Category[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [summaries, categories] = await Promise.all([
        this.budgetsService.list(),
        this.categoriesService.list(),
      ]);
      this.summaries.set(summaries);
      this.categories.set(categories);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load budgets.');
    } finally {
      this.loading.set(false);
    }
  }

  async archive(summary: BudgetSummary): Promise<void> {
    if (summary.budget.archivedAt ||
      !window.confirm(`Archive “${summary.budget.name}”? Existing spending and alert history will be kept.`)) return;
    try {
      await this.budgetsService.archive(summary.budget.id);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to archive this budget.');
    }
  }

  categoryName(categoryId?: string): string {
    if (!categoryId) return 'All expenses';
    return this.categories().find(({ id }) => id === categoryId)?.name ?? 'Archived category';
  }

  periodLabel(summary: BudgetSummary): string {
    const budget = summary.budget;
    if (budget.period === 'custom') return `Every ${budget.customPeriodDays} days`;
    return budget.period === 'weekly'
      ? 'Weekly'
      : budget.period === 'yearly'
        ? 'Yearly'
        : 'Monthly';
  }

  amount = formatPaise;
  percentage(value: number): string {
    return `${Math.round(value)}%`;
  }
}
