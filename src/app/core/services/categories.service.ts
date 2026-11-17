import { Inject, Injectable } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import type { Category } from '../models/finance.models';

export type CategoryType = Category['appliesTo'];
export type CategoryStatus = Category['status'];
export interface CategoryInput {
  name: string;
  appliesTo: CategoryType;
}

const DEFAULT_CATEGORIES: ReadonlyArray<CategoryInput> = [
  { name: 'Food', appliesTo: 'expense' },
  { name: 'Travel', appliesTo: 'expense' },
  { name: 'Shopping', appliesTo: 'expense' },
  { name: 'Education', appliesTo: 'expense' },
  { name: 'Entertainment', appliesTo: 'expense' },
  { name: 'Bills', appliesTo: 'expense' },
  { name: 'Healthcare', appliesTo: 'expense' },
  { name: 'Personal Care', appliesTo: 'expense' },
  { name: 'Subscriptions', appliesTo: 'expense' },
  { name: 'Other', appliesTo: 'expense' },
  { name: 'Salary', appliesTo: 'income' },
  { name: 'Freelancing', appliesTo: 'income' },
  { name: 'Gifts', appliesTo: 'income' },
  { name: 'Interest', appliesTo: 'income' },
  { name: 'Refunds', appliesTo: 'income' },
  { name: 'Other', appliesTo: 'income' },
];

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async ensureDefaults(): Promise<void> {
    await this.database.transaction('rw', this.database.categories, async () => {
      const current = await this.database.categories.toArray();
      const missing = DEFAULT_CATEGORIES.filter(
        (category) =>
          !current.some(
            (saved) =>
              saved.appliesTo === category.appliesTo &&
              saved.name.localeCompare(category.name, undefined, { sensitivity: 'accent' }) === 0,
          ),
      );
      if (missing.length === 0) return;

      const now = new Date().toISOString();
      await this.database.categories.bulkAdd(
        missing.map((category): Category => ({
          ...category,
          id: crypto.randomUUID(),
          isDefault: true,
          status: 'active',
          createdAt: now,
        })),
      );
    });
  }

  async list(status?: CategoryStatus, appliesTo?: CategoryType): Promise<Category[]> {
    await this.ensureDefaults();
    const categories = await this.database.categories.toArray();
    return categories
      .filter(
        (category) =>
          (!status || category.status === status) &&
          (!appliesTo || category.appliesTo === appliesTo),
      )
      .sort((left, right) => {
        const typeOrder = left.appliesTo.localeCompare(right.appliesTo);
        return typeOrder || left.name.localeCompare(right.name);
      });
  }

  async get(id: string): Promise<Category | undefined> {
    await this.ensureDefaults();
    return this.database.categories.get(id);
  }

  async create(input: CategoryInput): Promise<Category> {
    const name = this.validateName(input.name);
    this.validateType(input.appliesTo);
    await this.ensureDefaults();

    return this.database.transaction('rw', this.database.categories, async () => {
      await this.assertNameAvailable(name, input.appliesTo);
      const category: Category = {
        id: crypto.randomUUID(),
        name,
        appliesTo: input.appliesTo,
        isDefault: false,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await this.database.categories.add(category);
      return category;
    });
  }

  async update(id: string, nameInput: string): Promise<Category> {
    const name = this.validateName(nameInput);
    await this.ensureDefaults();

    return this.database.transaction('rw', this.database.categories, async () => {
      const category = await this.database.categories.get(id);
      if (!category) throw new Error('Category not found.');
      if (category.isDefault) throw new Error('Default categories cannot be edited.');
      await this.assertNameAvailable(name, category.appliesTo, id);

      const updated = { ...category, name };
      await this.database.categories.put(updated);
      return updated;
    });
  }

  async archive(id: string): Promise<Category> {
    await this.ensureDefaults();
    return this.database.transaction('rw', this.database.categories, async () => {
      const category = await this.database.categories.get(id);
      if (!category) throw new Error('Category not found.');
      if (category.isDefault) throw new Error('Default categories cannot be archived.');
      if (category.status === 'archived') return category;

      const archived = { ...category, status: 'archived' as const };
      await this.database.categories.put(archived);
      return archived;
    });
  }

  private async assertNameAvailable(
    name: string,
    appliesTo: CategoryType,
    exceptId?: string,
  ): Promise<void> {
    const categories = await this.database.categories.where('appliesTo').equals(appliesTo).toArray();
    if (
      categories.some(
        (category) =>
          category.id !== exceptId &&
          category.status === 'active' &&
          category.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      throw new Error('A category with this name already exists for this transaction type.');
    }
  }

  private validateName(value: string): string {
    const name = value.trim();
    if (!name) throw new Error('Category name cannot be empty.');
    if (name.length > 50) throw new Error('Category names cannot exceed 50 characters.');
    return name;
  }

  private validateType(value: string): asserts value is CategoryType {
    if (value !== 'income' && value !== 'expense') throw new Error('Choose a valid category type.');
  }
}
