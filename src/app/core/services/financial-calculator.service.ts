import { Injectable } from '@angular/core';

export type BasicOperator = '+' | '−' | '×' | '÷';
export type CompoundingFrequency = 'monthly' | 'quarterly' | 'yearly';

export interface EmiInput {
  principalPaise: number;
  annualRatePercent: number;
  tenureMonths: number;
}

export interface AmortizationInstallment {
  installment: number;
  paymentPaise: number;
  principalPaise: number;
  interestPaise: number;
  remainingBalancePaise: number;
}

export interface EmiResult {
  monthlyEmiPaise: number;
  totalInterestPaise: number;
  totalRepaymentPaise: number;
  schedule: AmortizationInstallment[];
}

export interface InterestInput {
  principalPaise: number;
  annualRatePercent: number;
  years: number;
  frequency: CompoundingFrequency;
}

export interface InterestResult {
  simpleInterestPaise: number;
  simpleFinalAmountPaise: number;
  compoundInterestPaise: number;
  compoundFinalAmountPaise: number;
}

export interface SipInput {
  monthlyInvestmentPaise: number;
  annualReturnPercent: number;
  years: number;
}

export interface SipResult {
  investedPaise: number;
  estimatedReturnsPaise: number;
  futureValuePaise: number;
  installments: number;
}

export interface FixedDepositInput {
  principalPaise: number;
  annualRatePercent: number;
  years: number;
  frequency: CompoundingFrequency;
}

export interface RecurringDepositInput {
  monthlyDepositPaise: number;
  annualRatePercent: number;
  years: number;
  frequency: CompoundingFrequency;
}

export interface DepositResult {
  investedPaise: number;
  estimatedInterestPaise: number;
  maturityValuePaise: number;
}

const DIVISION_PRECISION = 10;
const MAX_RATE_PERCENT = 1_000;
const COMPOUNDING_PER_YEAR: Readonly<Record<CompoundingFrequency, number>> = {
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

@Injectable({ providedIn: 'root' })
export class FinancialCalculatorService {
  add(left: string, right: string): string {
    return this.operate(left, right, '+');
  }

  subtract(left: string, right: string): string {
    return this.operate(left, right, '−');
  }

  multiply(left: string, right: string): string {
    return this.operate(left, right, '×');
  }

  divide(left: string, right: string): string {
    return this.operate(left, right, '÷');
  }

  percentage(value: string): string {
    return formatDecimal(divideDecimal(parseDecimal(value), { coefficient: 100n, scale: 0 }));
  }

  calculateBasic(left: string, right: string, operator: BasicOperator): string {
    return this.operate(left, right, operator);
  }

  calculateEmi(input: EmiInput): EmiResult {
    validatePrincipal(input.principalPaise);
    validateRate(input.annualRatePercent);
    validateInteger(input.tenureMonths, 1, 600, 'Loan tenure must be between 1 and 600 months.');

    const monthlyRate = input.annualRatePercent / 1_200;
    const growth = monthlyRate === 0 ? 1 : Math.pow(1 + monthlyRate, input.tenureMonths);
    const exactEmi = monthlyRate === 0
      ? input.principalPaise / input.tenureMonths
      : input.principalPaise * monthlyRate * growth / (growth - 1);
    const monthlyEmiPaise = toSafePaise(exactEmi, 'Monthly EMI exceeds the supported amount.');
    let remainingBalancePaise = input.principalPaise;
    let totalInterestPaise = 0;
    let totalRepaymentPaise = 0;
    const schedule: AmortizationInstallment[] = [];

    for (let installment = 1; installment <= input.tenureMonths; installment += 1) {
      const interestPaise = toSafePaise(remainingBalancePaise * monthlyRate, 'Installment interest exceeds the supported amount.');
      const isFinalInstallment = installment === input.tenureMonths;
      const principalPaise = isFinalInstallment
        ? remainingBalancePaise
        : Math.min(remainingBalancePaise, monthlyEmiPaise - interestPaise);
      if (principalPaise < 0) throw new RangeError('Calculated EMI does not cover the monthly interest.');
      const paymentPaise = safeAdd(principalPaise, interestPaise);
      remainingBalancePaise -= principalPaise;
      totalInterestPaise = safeAdd(totalInterestPaise, interestPaise);
      totalRepaymentPaise = safeAdd(totalRepaymentPaise, paymentPaise);
      schedule.push({
        installment,
        paymentPaise,
        principalPaise,
        interestPaise,
        remainingBalancePaise,
      });
    }

    return { monthlyEmiPaise, totalInterestPaise, totalRepaymentPaise, schedule };
  }

  calculateInterest(input: InterestInput): InterestResult {
    validatePrincipal(input.principalPaise);
    validateRate(input.annualRatePercent);
    validateYears(input.years);
    validateFrequency(input.frequency);

    const simpleInterestPaise = toSafePaise(
      input.principalPaise * input.annualRatePercent / 100 * input.years,
      'Simple interest exceeds the supported amount.',
    );
    const periods = COMPOUNDING_PER_YEAR[input.frequency] * input.years;
    const compoundFactor = Math.pow(
      1 + input.annualRatePercent / 100 / COMPOUNDING_PER_YEAR[input.frequency],
      periods,
    );
    const compoundFinalAmountPaise = toSafePaise(
      input.principalPaise * compoundFactor,
      'Compound amount exceeds the supported amount.',
    );
    const simpleFinalAmountPaise = safeAdd(input.principalPaise, simpleInterestPaise);
    const compoundInterestPaise = compoundFinalAmountPaise - input.principalPaise;
    return {
      simpleInterestPaise,
      simpleFinalAmountPaise,
      compoundInterestPaise,
      compoundFinalAmountPaise,
    };
  }

  calculateSip(input: SipInput): SipResult {
    validatePrincipal(input.monthlyInvestmentPaise);
    validateRate(input.annualReturnPercent);
    validateInteger(input.years, 1, 100, 'Investment duration must be between 1 and 100 years.');

    const installments = input.years * 12;
    const monthlyRate = input.annualReturnPercent / 100 / 12;
    const factor = monthlyRate === 0
      ? installments
      : (Math.pow(1 + monthlyRate, installments) - 1) / monthlyRate;
    const investedPaise = toSafePaise(
      input.monthlyInvestmentPaise * installments,
      'Total invested amount exceeds the supported amount.',
    );
    const futureValuePaise = toSafePaise(
      input.monthlyInvestmentPaise * factor,
      'Estimated future value exceeds the supported amount.',
    );
    return {
      investedPaise,
      estimatedReturnsPaise: futureValuePaise - investedPaise,
      futureValuePaise,
      installments,
    };
  }

  calculateFixedDeposit(input: FixedDepositInput): DepositResult {
    validatePrincipal(input.principalPaise);
    validateRate(input.annualRatePercent);
    validateYears(input.years);
    validateFrequency(input.frequency);
    const frequency = COMPOUNDING_PER_YEAR[input.frequency];
    const factor = Math.pow(
      1 + input.annualRatePercent / 100 / frequency,
      frequency * input.years,
    );
    const maturityValuePaise = toSafePaise(
      input.principalPaise * factor,
      'FD maturity value exceeds the supported amount.',
    );
    return {
      investedPaise: input.principalPaise,
      estimatedInterestPaise: maturityValuePaise - input.principalPaise,
      maturityValuePaise,
    };
  }

  calculateRecurringDeposit(input: RecurringDepositInput): DepositResult {
    validatePrincipal(input.monthlyDepositPaise);
    validateRate(input.annualRatePercent);
    validateInteger(input.years, 1, 100, 'Deposit duration must be between 1 and 100 years.');
    validateFrequency(input.frequency);

    const installments = input.years * 12;
    const frequency = COMPOUNDING_PER_YEAR[input.frequency];
    const monthlyRate = Math.pow(1 + input.annualRatePercent / 100 / frequency, frequency / 12) - 1;
    const factor = monthlyRate === 0
      ? installments
      : (Math.pow(1 + monthlyRate, installments) - 1) / monthlyRate;
    const investedPaise = toSafePaise(
      input.monthlyDepositPaise * installments,
      'Total RD deposits exceed the supported amount.',
    );
    const maturityValuePaise = toSafePaise(
      input.monthlyDepositPaise * factor,
      'RD maturity value exceeds the supported amount.',
    );
    return {
      investedPaise,
      estimatedInterestPaise: maturityValuePaise - investedPaise,
      maturityValuePaise,
    };
  }

  private operate(leftText: string, rightText: string, operator: BasicOperator): string {
    const left = parseDecimal(leftText);
    const right = parseDecimal(rightText);
    if (operator === '+') return formatDecimal(addDecimal(left, right));
    if (operator === '−') return formatDecimal(addDecimal(left, { coefficient: -right.coefficient, scale: right.scale }));
    if (operator === '×') {
      return formatDecimal({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
    }
    if (right.coefficient === 0n) throw new Error('Cannot divide by zero.');
    return formatDecimal(divideDecimal(left, right));
  }
}

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

function parseDecimal(value: string): DecimalValue {
  const normalized = value.trim();
  const match = /^([+-]?)(\d{1,15})(?:\.(\d{0,12}))?$/.exec(normalized);
  if (!match) throw new Error('Enter a valid number with up to 15 integer and 12 decimal digits.');
  const fractional = match[3] ?? '';
  const magnitude = BigInt(`${match[2]}${fractional}`);
  return {
    coefficient: match[1] === '-' ? -magnitude : magnitude,
    scale: fractional.length,
  };
}

function addDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: left.coefficient * powerOfTen(scale - left.scale) +
      right.coefficient * powerOfTen(scale - right.scale),
    scale,
  };
}

function divideDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
  if (right.coefficient === 0n) throw new Error('Cannot divide by zero.');
  let numerator = left.coefficient * powerOfTen(right.scale + DIVISION_PRECISION);
  let denominator = right.coefficient * powerOfTen(left.scale);
  const negative = (numerator < 0n) !== (denominator < 0n);
  if (numerator < 0n) numerator = -numerator;
  if (denominator < 0n) denominator = -denominator;
  const rounded = (numerator + denominator / 2n) / denominator;
  return { coefficient: negative ? -rounded : rounded, scale: DIVISION_PRECISION };
}

function formatDecimal(value: DecimalValue): string {
  const negative = value.coefficient < 0n;
  const magnitude = negative ? -value.coefficient : value.coefficient;
  const digits = magnitude.toString().padStart(value.scale + 1, '0');
  const integerPart = value.scale === 0 ? digits : digits.slice(0, -value.scale);
  const fractionalPart = value.scale === 0 ? '' : digits.slice(-value.scale).replace(/0+$/, '');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  return `${negative && magnitude !== 0n ? '-' : ''}${normalizedInteger || '0'}${fractionalPart ? `.${fractionalPart}` : ''}`;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function validatePrincipal(amountPaise: number): void {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Amount must be a positive whole number of paise.');
  }
}

function validateRate(ratePercent: number): void {
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > MAX_RATE_PERCENT) {
    throw new Error(`Annual rate must be between 0 and ${MAX_RATE_PERCENT}%.`);
  }
}

function validateYears(years: number): void {
  if (!Number.isFinite(years) || years <= 0 || years > 100) {
    throw new Error('Time period must be greater than 0 and no more than 100 years.');
  }
}

function validateFrequency(frequency: CompoundingFrequency): void {
  if (!Object.prototype.hasOwnProperty.call(COMPOUNDING_PER_YEAR, frequency)) {
    throw new Error('Choose monthly, quarterly or yearly compounding.');
  }
}

function validateInteger(value: number, minimum: number, maximum: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(message);
}

function toSafePaise(value: number, message: string): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new RangeError(message);
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new RangeError(message);
  return rounded;
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError('Calculated amount exceeds safe integer precision.');
  return total;
}
