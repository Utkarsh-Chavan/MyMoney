import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { LucideArrowLeft, LucideCalendarDays, LucideCircleAlert, LucideTags } from '@lucide/angular';
import type { Account, Category, EntryTransactionType, PaymentMethod } from '../../core/models/finance.models';
import { CategoriesService } from '../../core/services/categories.service';
import { AccountsService } from '../../core/services/accounts.service';
import { TransactionsService } from '../../core/services/transactions.service';
import {
  dateInputToTimestamp,
  localDateInputValue,
  paiseToRupeesInput,
  parseRupeesToPaise,
} from '../../core/utilities/money';

@Component({
  selector: 'app-transaction-form',
  imports: [FormsModule, RouterLink, LucideArrowLeft, LucideCalendarDays, LucideCircleAlert, LucideTags],
  templateUrl: './transaction-form.component.html',
})
export class TransactionFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly transactionsService = inject(TransactionsService);

  readonly transactionId = this.route.snapshot.paramMap.get('transactionId');
  readonly editing = this.transactionId !== null;
  readonly quickEntry = this.route.snapshot.data['entryMode'] === 'quick' && !this.editing;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly accounts = signal<Account[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly paymentMethods: PaymentMethod[] = ['cash', 'card', 'bank-transfer', 'upi', 'other'];
  readonly type = signal<EntryTransactionType>('expense');
  readonly selectedCategories = computed(() =>
    this.categories().filter(
      (category) =>
        category.appliesTo === this.type() &&
        (category.status === 'active' || category.id === this.categoryId),
    ),
  );
  readonly formAccounts = computed(() =>
    this.accounts().filter(
      (account) => account.status === 'active' || account.id === this.originalAccountId,
    ),
  );

  amount = '';
  accountId = '';
  categoryId = '';
  occurredOn = localDateInputValue();
  description = '';
  notes = '';
  tagsText = '';
  paymentMethod: PaymentMethod | '' = '';
  originalAccountId = '';

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [accounts, categories] = await Promise.all([
        this.accountsService.listAccounts(),
        this.categoriesService.list(),
      ]);
      this.accounts.set(accounts);
      this.categories.set(categories);

      if (this.transactionId) {
        const transaction = await this.transactionsService.get(this.transactionId);
        if (!transaction) throw new Error('Transaction not found.');
        if (transaction.type !== 'income' && transaction.type !== 'expense') {
          throw new Error('Internal transfers cannot be edited from this form.');
        }
        this.type.set(transaction.type);
        this.accountId = transaction.accountId ?? '';
        this.originalAccountId = transaction.accountId ?? '';
        this.categoryId = transaction.categoryId ?? '';
        this.amount = paiseToRupeesInput(transaction.amountPaise);
        this.occurredOn = transaction.occurredAt.slice(0, 10);
        this.description = transaction.description;
        this.notes = transaction.notes ?? '';
        this.tagsText = (transaction.tags ?? []).join(', ');
        this.paymentMethod = transaction.paymentMethod ?? '';
      } else {
        this.accountId = accounts.find(({ status }) => status === 'active')?.id ?? '';
        this.categoryId =
          categories.find(
            (category) => category.appliesTo === this.type() && category.status === 'active',
          )?.id ?? '';
      }

      if (this.formAccounts().length === 0) {
        this.error.set('Add an active account before recording transactions.');
      }
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  setType(type: EntryTransactionType): void {
    this.type.set(type);
    if (!this.selectedCategories().some(({ id }) => id === this.categoryId)) {
      this.categoryId = this.selectedCategories()[0]?.id ?? '';
    }
  }

  async save(): Promise<void> {
    this.error.set('');
    const amountPaise = parseRupeesToPaise(this.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter an amount greater than zero with no more than two decimal places.');
      return;
    }
    const occurredAt = dateInputToTimestamp(this.occurredOn);
    if (!occurredAt) {
      this.error.set('Choose a valid transaction date.');
      return;
    }

    this.saving.set(true);
    try {
      const input = {
        type: this.type(),
        amountPaise,
        accountId: this.accountId,
        categoryId: this.categoryId,
        occurredAt,
        description: this.description,
        notes: this.notes,
        tags: this.tagsText.split(','),
        paymentMethod: this.paymentMethod || undefined,
      };
      const transaction = this.transactionId
        ? await this.transactionsService.update(this.transactionId, input)
        : await this.transactionsService.create(input);
      await this.router.navigate(['/transactions', transaction.id]);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unable to save this transaction.';
  }
}
