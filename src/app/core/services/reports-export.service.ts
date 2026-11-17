import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import { formatPaise } from '../utilities/money';
import type { FinancialReport } from './reports.service';

@Injectable({ providedIn: 'root' })
export class ReportsExportService {
  transactionsCsv(report: FinancialReport): string {
    const accountNames = new Map(report.accounts.map(({ id, name }) => [id, name]));
    const categoryNames = new Map(report.categories.map(({ id, name }) => [id, name]));
    const rows = [
      ['Date', 'Type', 'Description', 'Account', 'Category', 'Amount (INR)'],
      ...report.transactions.map((transaction) => [
        transaction.occurredAt.slice(0, 10),
        transaction.type === 'income' ? 'Income' : 'Expense',
        transaction.description,
        accountNames.get(transaction.accountId ?? '') ?? '',
        categoryNames.get(transaction.categoryId ?? '') ?? '',
        `${transaction.type === 'income' ? '+' : '−'}${formatPaise(transaction.amountPaise)}`,
      ]),
    ];
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  summaryCsv(report: FinancialReport): string {
    const rows: string[][] = [
      ['Report metric', 'Value'],
      ['From date', report.filters.fromDate],
      ['To date', report.filters.toDate],
      ['Total income', formatPaise(report.incomePaise)],
      ['Total expenditure', formatPaise(report.expensePaise)],
      ['Net cash flow', formatPaise(report.netCashFlowPaise)],
      ['Net savings rate', `${report.savingsRatePercent.toFixed(2)}%`],
      ['Average daily expenditure', formatPaise(report.averageDailyExpensePaise)],
      ['Highest spending category', report.highestCategory?.name ?? 'No expense data'],
      ['Highest expenditure transaction', report.highestExpense?.description ?? 'No expense data'],
      [],
      ['Month', 'Income', 'Expenditure'],
      ...report.monthlyComparison.map((bucket) => [
        bucket.label,
        formatPaise(bucket.incomePaise),
        formatPaise(bucket.expensePaise),
      ]),
      [],
      ['Account spending', 'Amount'],
      ...report.accountSpending.map(({ name, amountPaise }) => [name, formatPaise(amountPaise)]),
      [],
      ['Category spending', 'Amount'],
      ...report.categorySpending.map(({ name, amountPaise }) => [name, formatPaise(amountPaise)]),
      [],
      ['Budget', 'Spent', 'Budget amount', 'Remaining'],
      ...report.budgets.map(({ budget, spentPaise, remainingPaise }) => [
        budget.name,
        formatPaise(spentPaise),
        formatPaise(budget.amountPaise),
        formatPaise(remainingPaise),
      ]),
      [],
      ['Loan', 'Direction', 'Status', 'Outstanding'],
      ...report.loans.map(({ loan, status, outstandingPaise }) => [
        'description' in loan ? loan.description ?? 'Loan' : 'Loan',
        loan.direction,
        status,
        formatPaise(outstandingPaise),
      ]),
      [],
      ['Savings goal', 'Saved', 'Target', 'Status'],
      ...report.savingsGoals.map(({ goal, savedPaise }) => [
        goal.name,
        formatPaise(savedPaise),
        formatPaise(goal.targetAmountPaise),
        goal.status,
      ]),
    ];
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  createPdf(report: FinancialReport): Uint8Array {
    const document = new jsPDF();
    const pageWidth = document.internal.pageSize.getWidth();
    const margin = 16;
    let y = 18;

    document.setFontSize(18);
    document.text('MyMoney · Financial report', margin, y);
    y += 9;
    document.setFontSize(10);
    document.text(`${report.filters.fromDate} to ${report.filters.toDate}`, margin, y);
    y += 10;

    const lines = [
      `Total income: ${formatPaise(report.incomePaise)}`,
      `Total expenditure: ${formatPaise(report.expensePaise)}`,
      `Net cash flow: ${formatPaise(report.netCashFlowPaise)}`,
      `Net savings rate: ${report.savingsRatePercent.toFixed(2)}%`,
      `Average daily expenditure: ${formatPaise(report.averageDailyExpensePaise)}`,
      `Highest spending category: ${report.highestCategory?.name ?? 'No expense data'}`,
      `Highest expenditure transaction: ${report.highestExpense?.description ?? 'No expense data'}`,
    ];
    document.setFontSize(11);
    for (const line of lines) {
      const wrapped = document.splitTextToSize(line, pageWidth - margin * 2);
      document.text(wrapped, margin, y);
      y += wrapped.length * 6 + 2;
    }

    y += 3;
    document.setFontSize(13);
    document.text('Monthly comparison', margin, y);
    y += 8;
    document.setFontSize(9);
    for (const bucket of report.monthlyComparison) {
      y = this.writePdfLine(
        document,
        `${bucket.label}  ·  Income ${formatPaise(bucket.incomePaise)}  ·  Expenditure ${formatPaise(bucket.expensePaise)}`,
        y,
        margin,
      );
    }
    y = this.writePdfSection(document, 'Category spending', report.categorySpending, y, margin);
    y = this.writePdfSection(document, 'Account spending', report.accountSpending, y, margin);
    y = this.writePdfSection(
      document,
      'Budgets at period end',
      report.budgets.map(({ budget, spentPaise }) => ({
        name: budget.name,
        amountPaise: spentPaise,
      })),
      y,
      margin,
    );
    y = this.writePdfSection(
      document,
      'Outstanding loans',
      report.loans.map(({ loan, outstandingPaise, status }) => ({
        name: `${loan.direction} · ${status}`,
        amountPaise: outstandingPaise,
      })),
      y,
      margin,
    );
    this.writePdfSection(
      document,
      'Savings goal progress · lifetime allocations',
      report.savingsGoals.map(({ goal, savedPaise }) => ({
        name: `${goal.name} · ${goal.status}`,
        amountPaise: savedPaise,
      })),
      y,
      margin,
    );
    return new Uint8Array(document.output('arraybuffer'));
  }

  private writePdfSection(
    document: jsPDF,
    title: string,
    rows: Array<{ name: string; amountPaise: number }>,
    y: number,
    margin: number,
  ): number {
    y += 4;
    if (y > 270) {
      document.addPage();
      y = 18;
    }
    document.setFontSize(13);
    document.text(title, margin, y);
    y += 8;
    document.setFontSize(9);
    for (const row of rows) {
      y = this.writePdfLine(document, `${row.name}: ${formatPaise(row.amountPaise)}`, y, margin);
    }
    return y;
  }

  private writePdfLine(document: jsPDF, value: string, y: number, margin: number): number {
    if (y > 280) {
      document.addPage();
      y = 18;
    }
    const lines = document.splitTextToSize(value, document.internal.pageSize.getWidth() - margin * 2);
    document.text(lines, margin, y);
    return y + lines.length * 5 + 2;
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
