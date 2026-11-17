import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck } from '@lucide/angular';
import type { Account, LoanDirection, Person } from '../../core/models/finance.models';
import { AccountsService } from '../../core/services/accounts.service';
import { LoansService, type LoanInput } from '../../core/services/loans.service';
import {
  formatPaise,
  localDateInputValue,
  paiseToRupeesInput,
  parseRupeesToPaise,
} from '../../core/utilities/money';

@Component({
  selector: 'app-loan-form',
  imports: [ReactiveFormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck],
  templateUrl: './loan-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoanFormComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loansService = inject(LoansService);
  private readonly accountsService = inject(AccountsService);

  readonly loanId = this.route.snapshot.paramMap.get('loanId');
  readonly editing = signal(this.loanId !== null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly hasRepayments = signal(false);
  readonly error = signal('');
  readonly people = signal<Person[]>([]);
  readonly accounts = signal<Account[]>([]);
  readonly form = this.formBuilder.nonNullable.group({
    direction: this.formBuilder.nonNullable.control<LoanDirection>('lent'),
    personId: this.formBuilder.nonNullable.control('', Validators.required),
    amount: this.formBuilder.nonNullable.control('', Validators.required),
    accountId: this.formBuilder.nonNullable.control('', Validators.required),
    startedAt: this.formBuilder.nonNullable.control(localDateInputValue(), Validators.required),
    dueDate: this.formBuilder.nonNullable.control(''),
    description: this.formBuilder.nonNullable.control(''),
    notes: this.formBuilder.nonNullable.control(''),
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [people, accounts] = await Promise.all([
        this.loansService.listPeople(),
        this.accountsService.listAccounts(),
      ]);
      this.people.set(people);
      this.accounts.set(accounts);

      if (this.loanId) {
        const details = await this.loansService.getDetails(this.loanId);
        const loan = details?.summary.loan;
        if (!loan || !('amountPaise' in loan) || !loan.amountPaise || !('personId' in loan) || !loan.personId) {
          throw new Error('Loan not found or legacy loan details are unavailable.');
        }
        this.form.patchValue({
          direction: loan.direction,
          personId: loan.personId,
          amount: paiseToRupeesInput(loan.amountPaise),
          accountId: loan.accountId ?? '',
          startedAt: loan.startedAt ?? localDateInputValue(),
          dueDate: loan.dueDate ?? '',
          description: loan.description ?? '',
          notes: loan.notes ?? '',
        });
        this.hasRepayments.set(details.history.some(({ entry }) => entry.outstandingChangePaise < 0));
        if (this.hasRepayments()) {
          this.form.controls.direction.disable();
          this.form.controls.personId.disable();
          this.form.controls.amount.disable();
          this.form.controls.accountId.disable();
          this.form.controls.startedAt.disable();
        }
      } else {
        const firstPerson = people.find(({ status }) => status === 'active');
        const firstAccount = accounts.find(({ status }) => status === 'active');
        this.form.patchValue({ personId: firstPerson?.id ?? '', accountId: firstAccount?.id ?? '' });
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load the loan form.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Complete the required loan details.');
      return;
    }
    const values = this.form.getRawValue();
    const amountPaise = parseRupeesToPaise(values.amount);
    if (amountPaise === null || amountPaise <= 0) {
      this.error.set('Enter a positive amount with no more than two decimal places.');
      return;
    }
    const input: LoanInput = {
      direction: values.direction,
      personId: values.personId,
      amountPaise,
      accountId: values.accountId,
      startedAt: values.startedAt,
      dueDate: values.dueDate || undefined,
      description: values.description,
      notes: values.notes,
    };

    this.saving.set(true);
    try {
      const loan = this.loanId
        ? await this.loansService.updateLoan(this.loanId, input)
        : await this.loansService.createLoan(input);
      await this.router.navigate(['/loans', loan.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to save this loan.');
    } finally {
      this.saving.set(false);
    }
  }

  getPersonStatus(person: Person): string {
    return person.status === 'active' ? '' : ' · Archived';
  }

  getAccountStatus(account: Account): string {
    return account.status === 'active' ? '' : ' · Archived';
  }

  formatMoney = formatPaise;
}
