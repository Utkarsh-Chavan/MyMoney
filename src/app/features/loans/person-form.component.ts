import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck } from '@lucide/angular';
import { LoansService, type PersonInput } from '../../core/services/loans.service';

@Component({
  selector: 'app-person-form',
  imports: [ReactiveFormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck],
  templateUrl: './person-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonFormComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loansService = inject(LoansService);

  readonly personId = this.route.snapshot.paramMap.get('personId');
  readonly editing = signal(this.personId !== null);
  readonly loading = signal(this.editing());
  readonly saving = signal(false);
  readonly error = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    name: this.formBuilder.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    phoneNumber: this.formBuilder.nonNullable.control('', Validators.maxLength(50)),
    notes: this.formBuilder.nonNullable.control('', Validators.maxLength(2_000)),
  });

  ngOnInit(): void {
    if (this.personId) void this.load(this.personId);
  }

  async save(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Enter a name and check the field limits.');
      return;
    }

    const input: PersonInput = this.form.getRawValue();
    this.saving.set(true);
    try {
      const person = this.personId
        ? await this.loansService.updatePerson(this.personId, input)
        : await this.loansService.createPerson(input);
      await this.router.navigate(this.personId ? ['/loans/people', person.id] : ['/loans']);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to save this person.');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    this.error.set('');
    try {
      const person = await this.loansService.getPerson(id);
      if (!person) throw new Error('Person not found.');
      this.form.patchValue({
        name: person.name,
        phoneNumber: person.phoneNumber ?? '',
        notes: person.notes ?? '',
      });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this person.');
    } finally {
      this.loading.set(false);
    }
  }
}
