import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { LucideArrowLeft, LucidePencil, LucideTrash2 } from '@lucide/angular';
import type { Account, Category, Transaction, TransactionType } from '../../core/models/finance.models';
import { AccountsService } from '../../core/services/accounts.service';
import { CategoriesService } from '../../core/services/categories.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { formatPaise, formatStoredDate } from '../../core/utilities/money';
import { paymentMethodLabel, transactionTypeLabel } from './transaction-labels';

@Component({
  selector: 'app-transaction-details',
  imports: [RouterLink, LucideArrowLeft, LucidePencil, LucideTrash2],
  templateUrl: './transaction-details.component.html',
})
export class TransactionDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transactionsService = inject(TransactionsService);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);

  readonly transactionId = this.route.snapshot.paramMap.get('transactionId') ?? '';
  readonly transaction = signal<Transaction | null>(null);
  readonly accounts = signal<Account[]>([]);
  readonly category = signal<Category | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [transaction, accounts, categories] = await Promise.all([
        this.transactionsService.get(this.transactionId),
        this.accountsService.listAccounts(),
        this.categoriesService.list(),
      ]);
      if (!transaction) throw new Error('Transaction not found.');
      this.transaction.set(transaction);
      this.accounts.set(accounts);
      this.category.set(categories.find(({ id }) => id === transaction.categoryId) ?? null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load transaction details.');
    } finally {
      this.loading.set(false);
    }
  }

  async delete(): Promise<void> {
    const transaction = this.transaction();
    if (!transaction || !window.confirm('Delete this transaction and its ledger entry? This cannot be undone.')) return;
    this.error.set('');
    try {
      await this.transactionsService.delete(transaction.id);
      await this.router.navigate(['/transactions']);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to delete this transaction.');
    }
  }

  accountName(id: string | undefined): string {
    if (!id) return 'Unknown account';
    return this.accounts().find(({ id: accountId }) => accountId === id)?.name ?? 'Unknown account';
  }

  typeLabel = transactionTypeLabel;
  dateLabel = formatStoredDate;
  formatMoney = formatPaise;
  paymentLabel = paymentMethodLabel;

  amountLabel(transaction: Transaction): string {
    if (transaction.type === 'income') return `+${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'expense') return `-${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-contribution') return `−${formatPaise(transaction.amountPaise)}`;
    if (transaction.type === 'savings-withdrawal') return `+${formatPaise(transaction.amountPaise)}`;
    return formatPaise(transaction.amountPaise);
  }

  isLoanTransaction(type: TransactionType): boolean {
    return (
      type === 'money-lent' ||
      type === 'money-borrowed' ||
      type === 'loan-repayment-received' ||
      type === 'loan-repayment-made'
    );
  }

  isSavingsTransaction(type: TransactionType): boolean {
    return type === 'savings-contribution' || type === 'savings-withdrawal';
  }
}
