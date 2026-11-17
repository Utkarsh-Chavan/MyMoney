import { DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, OnDestroy } from '@angular/core';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Chart } from 'chart.js/auto';
import {
  LucideArrowDownRight,
  LucideArrowUpRight,
  LucideDownload,
  LucideFileText,
  LucideRefreshCw,
} from '@lucide/angular';
import type { Account, Category } from '../../core/models/finance.models';
import { formatPaise, formatStoredDate, localDateInputValue } from '../../core/utilities/money';
import { ReportsExportService } from '../../core/services/reports-export.service';
import {
  ReportsService,
  type FinancialReport,
  type ReportBucket,
  type ReportFilters,
} from '../../core/services/reports.service';

type DatePreset = 'today' | 'last-7-days' | 'this-month' | 'previous-month' | 'this-year' | 'previous-year' | 'custom';

@Component({
  selector: 'app-reports',
  imports: [
    DecimalPipe,
    FormsModule,
    LucideArrowDownRight,
    LucideArrowUpRight,
    LucideDownload,
    LucideFileText,
    LucideRefreshCw,
  ],
  templateUrl: './reports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly reportsService = inject(ReportsService);
  private readonly exportService = inject(ReportsExportService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly charts = new Map<HTMLCanvasElement, Chart>();

  @ViewChildren('chart') private chartCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  readonly report = signal<FinancialReport | null>(null);
  readonly accounts = signal<Account[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly presetOptions: Array<{ value: DatePreset; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'last-7-days', label: 'Last 7 days' },
    { value: 'this-month', label: 'This month' },
    { value: 'previous-month', label: 'Previous month' },
    { value: 'this-year', label: 'This year' },
    { value: 'previous-year', label: 'Previous year' },
    { value: 'custom', label: 'Custom range' },
  ];

  preset: DatePreset = 'this-month';
  fromDate = '';
  toDate = '';
  accountId = '';
  categoryId = '';
  private viewReady = false;

  ngOnInit(): void {
    this.applyPreset('this-month');
    void this.loadOptionsAndReport();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderCharts();
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  async loadOptionsAndReport(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const report = await this.reportsService.generate(this.filters());
      this.accounts.set(report.accounts);
      this.categories.set(report.categories.filter(({ appliesTo }) => appliesTo === 'expense'));
      this.report.set(report);
      this.changeDetector.detectChanges();
      this.renderCharts();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load financial reports.');
    } finally {
      this.loading.set(false);
    }
  }

  async onPresetChange(value: DatePreset): Promise<void> {
    this.preset = value;
    if (value !== 'custom') {
      this.applyPreset(value);
      await this.loadOptionsAndReport();
    }
  }

  onManualDateChange(): void {
    this.preset = 'custom';
  }

  async applyFilters(): Promise<void> {
    await this.loadOptionsAndReport();
  }

  exportTransactionsCsv(): void {
    const report = this.requireReport();
    if (!report) return;
    this.download(
      this.exportService.transactionsCsv(report),
      'text/csv;charset=utf-8',
      `mymoney-transactions-${report.filters.fromDate}-${report.filters.toDate}.csv`,
    );
  }

  exportSummaryCsv(): void {
    const report = this.requireReport();
    if (!report) return;
    this.download(
      this.exportService.summaryCsv(report),
      'text/csv;charset=utf-8',
      `mymoney-report-${report.filters.fromDate}-${report.filters.toDate}.csv`,
    );
  }

  exportPdf(): void {
    const report = this.requireReport();
    if (!report) return;
    const data = this.exportService.createPdf(report);
    const pdfBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(pdfBuffer).set(data);
    this.download(
      new Blob([pdfBuffer], { type: 'application/pdf' }),
      'application/pdf',
      `mymoney-report-${report.filters.fromDate}-${report.filters.toDate}.pdf`,
    );
  }

  accountName(id: string | undefined): string {
    return this.accounts().find(({ id: accountId }) => accountId === id)?.name ?? 'Unknown account';
  }

  categoryName(id: string | undefined): string {
    return this.categories().find(({ id: categoryId }) => categoryId === id)?.name ?? 'Uncategorized';
  }

  transactionDate(value: string): string {
    return formatStoredDate(value);
  }

  formatMoney = formatPaise;

  hasSpend(bucket: ReportBucket): boolean {
    return bucket.expensePaise > 0;
  }

  hasActivity(bucket: ReportBucket): boolean {
    return bucket.expensePaise > 0 || bucket.incomePaise > 0;
  }

  private filters(): ReportFilters {
    return {
      fromDate: this.fromDate,
      toDate: this.toDate,
      accountId: this.accountId || undefined,
      categoryId: this.categoryId || undefined,
    };
  }

  private applyPreset(preset: Exclude<DatePreset, 'custom'>): void {
    const today = localDateInputValue();
    const [year, month] = today.split('-').map(Number);
    switch (preset) {
      case 'today':
        this.fromDate = today;
        this.toDate = today;
        break;
      case 'last-7-days':
        this.fromDate = addDays(today, -6);
        this.toDate = today;
        break;
      case 'this-month':
        this.fromDate = `${today.slice(0, 7)}-01`;
        this.toDate = today;
        break;
      case 'previous-month': {
        const start = new Date(Date.UTC(year, month - 2, 1));
        this.fromDate = toDateOnly(start);
        this.toDate = toDateOnly(new Date(Date.UTC(year, month - 1, 0)));
        break;
      }
      case 'this-year':
        this.fromDate = `${year}-01-01`;
        this.toDate = today;
        break;
      case 'previous-year':
        this.fromDate = `${year - 1}-01-01`;
        this.toDate = `${year - 1}-12-31`;
        break;
    }
  }

  private renderCharts(): void {
    const report = this.report();
    if (!this.viewReady || !report) return;
    this.destroyCharts();
    for (const element of this.chartCanvases) {
      const canvas = element.nativeElement;
      const kind = canvas.dataset['chart'];
      const chart = this.createChart(canvas, kind, report);
      if (chart) this.charts.set(canvas, chart);
    }
  }

  private createChart(canvas: HTMLCanvasElement, kind: string | undefined, report: FinancialReport): Chart | undefined {
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#777d93';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#e7e8f0';
    const moneyTicks = {
      callback: (value: string | number) => formatAxisMoney(Number(value)),
      color: textColor,
    };
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor, usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: moneyTicks, grid: { color: gridColor } },
      },
    };
    switch (kind) {
      case 'income-expense':
        return new Chart(canvas, {
          type: 'bar',
          data: {
            labels: report.monthlyComparison.map(({ label }) => label),
            datasets: [
              { label: 'Income', data: report.monthlyComparison.map(({ incomePaise }) => incomePaise), backgroundColor: '#218463', borderRadius: 4 },
              { label: 'Expenditure', data: report.monthlyComparison.map(({ expensePaise }) => expensePaise), backgroundColor: '#cf5365', borderRadius: 4 },
            ],
          },
          options: {
            ...base,
            plugins: {
              ...base.plugins,
              tooltip: { callbacks: { label: (context) => `${context.dataset.label ?? ''}: ${formatAxisMoney(context.parsed.y)}` } },
            },
          },
        });
      case 'weekly-spending':
        return new Chart(canvas, {
          type: 'line',
          data: {
            labels: report.weeklySpending.map(({ label }) => label),
            datasets: [{
              label: 'Daily expenditure',
              data: report.weeklySpending.map(({ expensePaise }) => expensePaise),
              borderColor: '#6758dc',
              backgroundColor: 'rgb(103 88 220 / 14%)',
              fill: true,
              tension: 0.3,
            }],
          },
          options: {
            ...base,
            plugins: {
              ...base.plugins,
              tooltip: { callbacks: { label: (context) => `${context.dataset.label ?? ''}: ${formatAxisMoney(context.parsed.y)}` } },
            },
          },
        });
      case 'monthly-trend':
        return new Chart(canvas, {
          type: 'line',
          data: {
            labels: report.monthlyComparison.map(({ label }) => label),
            datasets: [{
              label: 'Monthly expenditure',
              data: report.monthlyComparison.map(({ expensePaise }) => expensePaise),
              borderColor: '#cf5365',
              backgroundColor: 'rgb(207 83 101 / 12%)',
              fill: true,
              tension: 0.25,
            }],
          },
          options: {
            ...base,
            plugins: {
              ...base.plugins,
              tooltip: { callbacks: { label: (context) => `${context.dataset.label ?? ''}: ${formatAxisMoney(context.parsed.y)}` } },
            },
          },
        });
      case 'categories':
        return new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: report.categorySpending.map(({ name }) => name),
            datasets: [{
              data: report.categorySpending.map(({ amountPaise }) => amountPaise),
              backgroundColor: ['#6758dc', '#738ce7', '#218463', '#cf5365', '#bc7c22', '#a28bd9', '#5296a8'],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true, boxWidth: 8 } },
              tooltip: { callbacks: { label: (context) => `${context.label}: ${formatAxisMoney(context.parsed)}` } },
            },
          },
        });
      case 'accounts':
        return new Chart(canvas, {
          type: 'bar',
          data: {
            labels: report.accountSpending.map(({ name }) => name),
            datasets: [{ label: 'Expenditure', data: report.accountSpending.map(({ amountPaise }) => amountPaise), backgroundColor: '#738ce7', borderRadius: 4 }],
          },
          options: {
            ...base,
            indexAxis: 'y',
            plugins: {
              ...base.plugins,
              tooltip: { callbacks: { label: (context) => `${context.dataset.label ?? ''}: ${formatAxisMoney(context.parsed.x)}` } },
            },
            scales: {
              x: { ticks: moneyTicks, grid: { color: gridColor } },
              y: { ticks: { color: textColor }, grid: { display: false } },
            },
          },
        });
      case 'yearly':
        return new Chart(canvas, {
          type: 'bar',
          data: {
            labels: report.yearlyOverview.map(({ label }) => label),
            datasets: [
              { label: 'Income', data: report.yearlyOverview.map(({ incomePaise }) => incomePaise), backgroundColor: '#218463', borderRadius: 4 },
              { label: 'Expenditure', data: report.yearlyOverview.map(({ expensePaise }) => expensePaise), backgroundColor: '#cf5365', borderRadius: 4 },
            ],
          },
          options: {
            ...base,
            plugins: {
              ...base.plugins,
              tooltip: { callbacks: { label: (context) => `${context.dataset.label ?? ''}: ${formatAxisMoney(context.parsed.y)}` } },
            },
            scales: { ...base.scales, x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } },
          },
        });
      default:
        return undefined;
    }
  }

  private requireReport(): FinancialReport | undefined {
    const report = this.report();
    if (!report) this.error.set('Load a report before exporting.');
    return report ?? undefined;
  }

  private destroyCharts(): void {
    for (const chart of this.charts.values()) chart.destroy();
    this.charts.clear();
  }

  private download(data: BlobPart, type: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return toDateOnly(result);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatAxisMoney(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return '';
  return formatPaise(Math.round(value));
}
