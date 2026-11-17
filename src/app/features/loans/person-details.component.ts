import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { LucideArchive, LucideArrowLeft, LucidePencil } from '@lucide/angular';
import type { Account, Person } from '../../core/models/finance.models';
import { AccountsService } from '../../core/services/accounts.service';
import { LoansService, type LoanStatus, type LoanSummary } from '../../core/services/loans.service';
import { formatPaise, formatStoredDate } from '../../core/utilities/money';

@Component({
  selector: 'app-person-details',
  imports: [RouterLink, LucideArchive, LucideArrowLeft, LucidePencil],
  templateUrl: './person-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly loansService = inject(LoansService);
  private readonly accountsService = inject(AccountsService);

  readonly personId = this.route.snapshot.paramMap.get('personId') ?? '';
  readonly person = signal<Person | null>(null);
  readonly loans = signal<LoanSummary[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly loanCount = computed(() => this.loans().length);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const person = await this.loansService.getPerson(this.personId);
      if (!person) throw new Error('Person not found.');
      const [loans, accounts] = await Promise.all([
        this.loadAllLoans(),
        this.accountsService.listAccounts(),
      ]);
      this.person.set(person);
      this.loans.set(loans);
      this.accounts.set(accounts);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this person.');
    } finally {
      this.loading.set(false);
    }
  }

  async archive(): Promise<void> {
    const person = this.person();
    if (!person || person.status === 'archived') return;
    if (!window.confirm(`Archive ${person.name}? Their loans and repayment history will remain available.`)) return;
    this.error.set('');
    try {
      await this.loansService.archivePerson(person.id);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to archive this person.');
    }
  }

  accountName(summary: LoanSummary): string {
    const accountId = 'accountId' in summary.loan ? summary.loan.accountId : undefined;
    return this.accounts().find(({ id }) => id === accountId)?.name ?? 'Account unavailable';
  }

  loanDate(summary: LoanSummary): string {
    const date = 'startedAt' in summary.loan && summary.loan.startedAt
      ? summary.loan.startedAt
      : summary.loan.createdAt;
    return formatStoredDate(date);
  }

  directionLabel(direction: 'lent' | 'borrowed'): string {
    return direction === 'lent' ? 'Money lent' : 'Money borrowed';
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

  outstandingLabel(summary: LoanSummary): string {
    return summary.principalPaise === null ? 'Unavailable' : formatPaise(summary.outstandingPaise);
  }

  formatDate = formatStoredDate;

  private async loadAllLoans(): Promise<LoanSummary[]> {
    const all: LoanSummary[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.loansService.list({ personId: this.personId, page, pageSize: 100 });
      all.push(...result.items);
      if (all.length >= result.totalItems) return all;
    }
  }
}
