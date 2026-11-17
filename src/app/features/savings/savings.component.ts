import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideArchive, LucideArrowUpRight, LucidePlus, LucideTarget } from '@lucide/angular';
import { SavingsGoalsService, type SavingsGoalProgress } from '../../core/services/savings-goals.service';
import { formatPaise, formatStoredDate, localDateInputValue } from '../../core/utilities/money';

@Component({
  selector: 'app-savings',
  imports: [DecimalPipe, RouterLink, LucideArchive, LucideArrowUpRight, LucidePlus, LucideTarget],
  templateUrl: './savings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavingsComponent implements OnInit {
  private readonly goalsService = inject(SavingsGoalsService);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly goals = signal<SavingsGoalProgress[]>([]);
  readonly currentGoals = computed(() => this.goals().filter(({ goal }) => goal.status !== 'archived'));
  readonly activeGoals = computed(() => this.currentGoals().filter(({ goal }) => goal.status === 'active'));
  readonly completedGoals = computed(() => this.currentGoals().filter(({ goal }) => goal.status === 'completed'));
  readonly archivedGoals = computed(() => this.goals().filter(({ goal }) => goal.status === 'archived'));
  readonly totalTargetPaise = computed(() => this.sumSafe(this.currentGoals().map(({ goal }) => goal.targetAmountPaise)));
  readonly totalSavedPaise = computed(() => this.sumSafe(this.currentGoals().map(({ savedPaise }) => savedPaise)));
  readonly totalRemainingPaise = computed(() => this.sumSafe(this.currentGoals().map(({ remainingPaise }) => remainingPaise)));
  readonly upcomingGoals = computed(() => this.activeGoals()
    .filter(({ goal }) => !!goal.targetDate && goal.targetDate >= this.today)
    .sort((left, right) => left.goal.targetDate!.localeCompare(right.goal.targetDate!))
    .slice(0, 3));
  readonly today = localDateInputValue();

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try { this.goals.set(await this.goalsService.list()); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Unable to load savings goals.'); }
    finally { this.loading.set(false); }
  }

  async archive(item: SavingsGoalProgress): Promise<void> {
    if (item.goal.status !== 'completed' ||
      !window.confirm(`Archive “${item.goal.name}”? Its contribution history will be preserved.`)) return;
    this.error.set('');
    try {
      await this.goalsService.archive(item.goal.id);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to archive this goal.');
    }
  }

  amount = formatPaise;
  date = formatStoredDate;
  percentage(value: number): number { return Math.min(value, 100); }

  private sumSafe(values: number[]): number {
    return values.reduce((total, value) => {
      const next = total + value;
      if (!Number.isSafeInteger(value) || !Number.isSafeInteger(next)) {
        throw new RangeError('Savings goal totals exceed safe integer precision.');
      }
      return next;
    }, 0);
  }
}
