import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideArchive, LucidePencil, LucidePlus } from '@lucide/angular';
import type { Category } from '../../core/models/finance.models';
import { CategoriesService, type CategoryStatus, type CategoryType } from '../../core/services/categories.service';

@Component({
  selector: 'app-categories',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideArchive, LucidePencil, LucidePlus],
  templateUrl: './categories.component.html',
})
export class CategoriesComponent implements OnInit {
  private readonly categoriesService = inject(CategoriesService);

  readonly categories = signal<Category[]>([]);
  readonly status = signal<CategoryStatus>('active');
  readonly editingId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly visibleCategories = computed(() => this.categories().filter((category) => category.status === this.status()));

  name = '';
  appliesTo: CategoryType = 'expense';

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      this.categories.set(await this.categoriesService.list());
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  startEdit(category: Category): void {
    if (category.isDefault || category.status !== 'active') return;
    this.editingId.set(category.id);
    this.name = category.name;
    this.appliesTo = category.appliesTo;
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.name = '';
    this.appliesTo = 'expense';
  }

  async save(): Promise<void> {
    this.error.set('');
    this.saving.set(true);
    try {
      if (this.editingId()) {
        await this.categoriesService.update(this.editingId()!, this.name);
      } else {
        await this.categoriesService.create({ name: this.name, appliesTo: this.appliesTo });
      }
      this.cancelEdit();
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  async archive(category: Category): Promise<void> {
    if (category.isDefault || !window.confirm(`Archive “${category.name}”? Existing transactions will keep this category.`)) {
      return;
    }
    this.error.set('');
    try {
      await this.categoriesService.archive(category.id);
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  async setStatus(status: CategoryStatus): Promise<void> {
    this.status.set(status);
    await this.load();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to save category changes.';
  }
}
