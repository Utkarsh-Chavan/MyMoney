import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCalculator, LucidePercent, LucideTrendingUp } from '@lucide/angular';
import { FinancialCalculatorService, type BasicOperator, type CompoundingFrequency } from '../../core/services/financial-calculator.service';
import type {
  DepositResult,
  EmiResult,
  InterestResult,
  SipResult,
} from '../../core/services/financial-calculator.service';
import { formatPaise, parseRupeesToPaise } from '../../core/utilities/money';

type CalculatorTab = 'basic' | 'emi' | 'interest' | 'sip' | 'deposits';
type DepositMode = 'fd' | 'rd';

@Component({
  selector: 'app-financial-calculator',
  imports: [FormsModule, LucideCalculator, LucidePercent, LucideTrendingUp],
  templateUrl: './financial-calculator.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancialCalculatorComponent {
  private readonly calculator = inject(FinancialCalculatorService);

  readonly activeTab = signal<CalculatorTab>('basic');
  readonly basicDisplay = signal('0');
  readonly basicError = signal('');
  readonly emiResult = signal<EmiResult | null>(null);
  readonly emiError = signal('');
  readonly interestResult = signal<InterestResult | null>(null);
  readonly interestError = signal('');
  readonly sipResult = signal<SipResult | null>(null);
  readonly sipError = signal('');
  readonly depositResult = signal<DepositResult | null>(null);
  readonly depositError = signal('');
  readonly depositMode = signal<DepositMode>('fd');

  readonly tabs: Array<{ id: CalculatorTab; label: string }> = [
    { id: 'basic', label: 'Basic' },
    { id: 'emi', label: 'EMI' },
    { id: 'interest', label: 'Interest' },
    { id: 'sip', label: 'SIP' },
    { id: 'deposits', label: 'FD / RD' },
  ];

  emiPrincipal = '';
  emiRate = '8.5';
  emiTenure = '20';
  emiTenureUnit: 'months' | 'years' = 'years';

  interestPrincipal = '';
  interestRate = '7';
  interestYears = '5';
  interestFrequency: CompoundingFrequency = 'quarterly';

  sipMonthlyInvestment = '';
  sipRate = '12';
  sipYears = '10';

  fdPrincipal = '';
  fdRate = '7';
  fdYears = '1';
  fdFrequency: CompoundingFrequency = 'quarterly';
  rdMonthlyDeposit = '';
  rdRate = '7';
  rdYears = '5';
  rdFrequency: CompoundingFrequency = 'quarterly';

  private storedValue: string | null = null;
  private pendingOperator: BasicOperator | null = null;
  private startNewNumber = false;

  selectTab(tab: CalculatorTab): void {
    this.activeTab.set(tab);
  }

  pressDigit(digit: string): void {
    this.basicError.set('');
    if (this.startNewNumber) {
      this.basicDisplay.set(digit);
      this.startNewNumber = false;
      return;
    }
    this.basicDisplay.update((value) => value === '0' ? digit : value.length < 24 ? value + digit : value);
  }

  pressDecimal(): void {
    this.basicError.set('');
    if (this.startNewNumber) {
      this.basicDisplay.set('0.');
      this.startNewNumber = false;
      return;
    }
    this.basicDisplay.update((value) => value.includes('.') ? value : value + '.');
  }

  setOperator(operator: BasicOperator): void {
    this.basicError.set('');
    if (this.pendingOperator && this.storedValue !== null && !this.startNewNumber) {
      this.calculateBasic();
    }
    this.storedValue = this.basicDisplay();
    this.pendingOperator = operator;
    this.startNewNumber = true;
  }

  calculateBasic(): void {
    if (this.storedValue === null || !this.pendingOperator) return;
    try {
      this.basicDisplay.set(
        this.calculator.calculateBasic(this.storedValue, this.basicDisplay(), this.pendingOperator),
      );
      this.storedValue = null;
      this.pendingOperator = null;
      this.startNewNumber = true;
      this.basicError.set('');
    } catch (error) {
      this.storedValue = null;
      this.pendingOperator = null;
      this.startNewNumber = true;
      this.basicError.set(errorMessage(error, 'Unable to calculate this expression.'));
    }
  }

  applyPercent(): void {
    try {
      this.basicDisplay.set(this.calculator.percentage(this.basicDisplay()));
      this.basicError.set('');
    } catch (error) {
      this.basicError.set(errorMessage(error, 'Enter a valid number.'));
    }
  }

  backspace(): void {
    this.basicError.set('');
    this.startNewNumber = false;
    this.basicDisplay.update((value) => value.length <= 1 || (value.length === 2 && value.startsWith('-'))
      ? '0'
      : value.slice(0, -1));
  }

  clearBasic(): void {
    this.basicDisplay.set('0');
    this.storedValue = null;
    this.pendingOperator = null;
    this.startNewNumber = false;
    this.basicError.set('');
  }

  calculateEmi(): void {
    try {
      const principalPaise = this.moneyInput(this.emiPrincipal, 'Loan principal');
      const tenureValue = this.positiveInteger(this.emiTenure, 'Loan tenure');
      const tenureMonths = this.emiTenureUnit === 'years' ? tenureValue * 12 : tenureValue;
      this.emiResult.set(this.calculator.calculateEmi({
        principalPaise,
        annualRatePercent: this.decimalInput(this.emiRate, 'Annual interest rate'),
        tenureMonths,
      }));
      this.emiError.set('');
    } catch (error) {
      this.emiResult.set(null);
      this.emiError.set(errorMessage(error, 'Check the EMI inputs and try again.'));
    }
  }

  calculateInterest(): void {
    try {
      this.interestResult.set(this.calculator.calculateInterest({
        principalPaise: this.moneyInput(this.interestPrincipal, 'Principal'),
        annualRatePercent: this.decimalInput(this.interestRate, 'Annual interest rate'),
        years: this.decimalInput(this.interestYears, 'Time period'),
        frequency: this.interestFrequency,
      }));
      this.interestError.set('');
    } catch (error) {
      this.interestResult.set(null);
      this.interestError.set(errorMessage(error, 'Check the interest inputs and try again.'));
    }
  }

  calculateSip(): void {
    try {
      this.sipResult.set(this.calculator.calculateSip({
        monthlyInvestmentPaise: this.moneyInput(this.sipMonthlyInvestment, 'Monthly investment'),
        annualReturnPercent: this.decimalInput(this.sipRate, 'Expected annual return'),
        years: this.positiveInteger(this.sipYears, 'Investment duration'),
      }));
      this.sipError.set('');
    } catch (error) {
      this.sipResult.set(null);
      this.sipError.set(errorMessage(error, 'Check the SIP inputs and try again.'));
    }
  }

  calculateDeposit(): void {
    try {
      const result = this.depositMode() === 'fd'
        ? this.calculator.calculateFixedDeposit({
          principalPaise: this.moneyInput(this.fdPrincipal, 'FD principal'),
          annualRatePercent: this.decimalInput(this.fdRate, 'Annual interest rate'),
          years: this.decimalInput(this.fdYears, 'Deposit duration'),
          frequency: this.fdFrequency,
        })
        : this.calculator.calculateRecurringDeposit({
          monthlyDepositPaise: this.moneyInput(this.rdMonthlyDeposit, 'Monthly deposit'),
          annualRatePercent: this.decimalInput(this.rdRate, 'Annual interest rate'),
          years: this.positiveInteger(this.rdYears, 'Deposit duration'),
          frequency: this.rdFrequency,
        });
      this.depositResult.set(result);
      this.depositError.set('');
    } catch (error) {
      this.depositResult.set(null);
      this.depositError.set(errorMessage(error, 'Check the deposit inputs and try again.'));
    }
  }

  chooseDepositMode(mode: DepositMode): void {
    this.depositMode.set(mode);
    this.depositResult.set(null);
    this.depositError.set('');
  }

  formatMoney = formatPaise;

  private moneyInput(value: string, label: string): number {
    const parsed = parseRupeesToPaise(value);
    if (parsed === null || parsed <= 0) throw new Error(`${label} must be a positive rupee amount with up to 2 decimal places.`);
    return parsed;
  }

  private decimalInput(value: string, label: string): number {
    if (!value.trim() || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())) {
      throw new Error(`${label} must be a valid non-negative number.`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid non-negative number.`);
    return parsed;
  }

  private positiveInteger(value: string, label: string): number {
    if (!/^[1-9]\d*$/.test(value.trim())) throw new Error(`${label} must be a positive whole number.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the supported range.`);
    return parsed;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
