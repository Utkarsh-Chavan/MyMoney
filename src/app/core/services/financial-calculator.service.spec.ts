import { describe, expect, it } from 'vitest';
import { formatPaise } from '../utilities/money';
import { FinancialCalculatorService } from './financial-calculator.service';

describe('FinancialCalculatorService', () => {
  const calculator = new FinancialCalculatorService();

  it('calculates basic arithmetic exactly for decimal inputs and supports percent', () => {
    expect(calculator.add('0.1', '0.2')).toBe('0.3');
    expect(calculator.subtract('10.25', '0.5')).toBe('9.75');
    expect(calculator.multiply('1.25', '4')).toBe('5');
    expect(calculator.divide('1', '8')).toBe('0.125');
    expect(calculator.divide('1', '3')).toBe('0.3333333333');
    expect(calculator.percentage('12.5')).toBe('0.125');
  });

  it('rejects invalid numbers and division by zero', () => {
    expect(() => calculator.add('1.1234567890123', '1')).toThrow('up to 15 integer and 12 decimal digits');
    expect(() => calculator.divide('4', '0')).toThrow('Cannot divide by zero');
    expect(() => calculator.multiply('1,000', '2')).toThrow('Enter a valid number');
  });

  it('calculates zero-interest EMI and produces a fully paid amortization schedule', () => {
    const result = calculator.calculateEmi({
      principalPaise: 1_200_000,
      annualRatePercent: 0,
      tenureMonths: 12,
    });
    expect(result.monthlyEmiPaise).toBe(100_000);
    expect(result.totalInterestPaise).toBe(0);
    expect(result.totalRepaymentPaise).toBe(1_200_000);
    expect(result.schedule).toHaveLength(12);
    expect(result.schedule[11].remainingBalancePaise).toBe(0);
    expect(result.schedule.reduce((sum, row) => sum + row.principalPaise, 0)).toBe(1_200_000);
  });

  it('calculates reducing-balance EMI and reconciles every installment', () => {
    const result = calculator.calculateEmi({
      principalPaise: 1_000_000,
      annualRatePercent: 12,
      tenureMonths: 12,
    });
    expect(result.monthlyEmiPaise).toBe(88_849);
    expect(result.schedule[0].interestPaise).toBe(10_000);
    expect(result.schedule.at(-1)?.remainingBalancePaise).toBe(0);
    expect(result.totalRepaymentPaise).toBe(
      result.schedule.reduce((sum, row) => sum + row.paymentPaise, 0),
    );
    expect(result.totalInterestPaise).toBe(
      result.schedule.reduce((sum, row) => sum + row.interestPaise, 0),
    );
  });

  it('calculates simple and compound interest at the selected frequency', () => {
    const result = calculator.calculateInterest({
      principalPaise: 100_000,
      annualRatePercent: 10,
      years: 2,
      frequency: 'quarterly',
    });
    expect(result.simpleInterestPaise).toBe(20_000);
    expect(result.simpleFinalAmountPaise).toBe(120_000);
    expect(result.compoundFinalAmountPaise).toBe(121_840);
    expect(result.compoundInterestPaise).toBe(21_840);
  });

  it('calculates zero-interest SIP and FD/RD values', () => {
    expect(calculator.calculateSip({
      monthlyInvestmentPaise: 100_000,
      annualReturnPercent: 0,
      years: 1,
    })).toMatchObject({
      investedPaise: 1_200_000,
      estimatedReturnsPaise: 0,
      futureValuePaise: 1_200_000,
      installments: 12,
    });

    expect(calculator.calculateFixedDeposit({
      principalPaise: 250_000,
      annualRatePercent: 0,
      years: 2,
      frequency: 'monthly',
    })).toEqual({
      investedPaise: 250_000,
      estimatedInterestPaise: 0,
      maturityValuePaise: 250_000,
    });

    expect(calculator.calculateRecurringDeposit({
      monthlyDepositPaise: 10_000,
      annualRatePercent: 0,
      years: 2,
      frequency: 'quarterly',
    })).toEqual({
      investedPaise: 240_000,
      estimatedInterestPaise: 0,
      maturityValuePaise: 240_000,
    });
  });

  it('calculates positive projected returns for SIP and deposits', () => {
    const sip = calculator.calculateSip({
      monthlyInvestmentPaise: 10_000,
      annualReturnPercent: 12,
      years: 1,
    });
    const fd = calculator.calculateFixedDeposit({
      principalPaise: 100_000,
      annualRatePercent: 8,
      years: 1,
      frequency: 'quarterly',
    });
    const rd = calculator.calculateRecurringDeposit({
      monthlyDepositPaise: 10_000,
      annualRatePercent: 8,
      years: 1,
      frequency: 'quarterly',
    });
    expect(sip.futureValuePaise).toBeGreaterThan(sip.investedPaise);
    expect(fd.maturityValuePaise).toBeGreaterThan(fd.investedPaise);
    expect(rd.maturityValuePaise).toBeGreaterThan(rd.investedPaise);
  });

  it('validates amount, rate, tenure and compounding inputs', () => {
    expect(() => calculator.calculateEmi({ principalPaise: 0, annualRatePercent: 5, tenureMonths: 12 }))
      .toThrow('positive whole number of paise');
    expect(() => calculator.calculateEmi({ principalPaise: 100, annualRatePercent: -1, tenureMonths: 12 }))
      .toThrow('Annual rate must be between');
    expect(() => calculator.calculateEmi({ principalPaise: 100, annualRatePercent: 5, tenureMonths: 0 }))
      .toThrow('between 1 and 600 months');
    expect(() => calculator.calculateSip({ monthlyInvestmentPaise: 100, annualReturnPercent: 5, years: 0 }))
      .toThrow('between 1 and 100 years');
    expect(() => calculator.calculateInterest({
      principalPaise: 100,
      annualRatePercent: 5,
      years: 1,
      frequency: 'daily' as 'monthly',
    })).toThrow('Choose monthly, quarterly or yearly');
  });

  it('formats calculated integer paise as INR', () => {
    expect(formatPaise(1_234_567)).toBe('₹12,345.67');
  });
});
