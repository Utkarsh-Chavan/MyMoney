export type AccountType =
  | 'savings-bank'
  | 'current-bank'
  | 'cash-wallet'
  | 'digital-wallet'
  | 'other';
export type AccountStatus = 'active' | 'archived';

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'savings-contribution'
  | 'savings-withdrawal'
  | 'money-lent'
  | 'money-borrowed'
  | 'loan-repayment-received'
  | 'loan-repayment-made';
export type EntryTransactionType = 'income' | 'expense';
export type PaymentMethod = 'cash' | 'card' | 'bank-transfer' | 'upi' | 'other';

export type LoanDirection = 'lent' | 'borrowed';
export type PersonStatus = 'active' | 'archived';
export type BudgetPeriod = 'weekly' | 'monthly' | 'custom' | 'yearly';
export type BudgetAlertThreshold = 50 | 75 | 90 | 100;

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  currency: 'INR';
  openingBalancePaise: number;
  openingDate: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amountPaise: number;
  occurredAt: string;
  description: string;
  accountId?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  loanId?: string;
  savingsGoalId?: string;
  notes?: string;
  tags?: string[];
  paymentMethod?: PaymentMethod;
  createdAt: string;
  updatedAt: string;
  voidedAt?: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  occurredAt: string;
  /** Signed change to the owned account balance, in paise. */
  amountPaise: number;
}

export interface Person {
  id: string;
  name: string;
  phoneNumber?: string;
  notes?: string;
  status: PersonStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface Loan {
  id: string;
  direction: LoanDirection;
  personId: string;
  amountPaise: number;
  accountId: string;
  startedAt: string;
  dueDate?: string;
  description?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export interface LegacyLoan {
  id: string;
  direction: LoanDirection;
  personId?: string;
  personName?: string;
  amountPaise?: number;
  accountId?: string;
  startedAt?: string;
  dueDate?: string;
  description?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export type StoredLoan = Loan | LegacyLoan;

export interface LoanEntry {
  id: string;
  transactionId: string;
  loanId: string;
  occurredAt: string;
  /** Positive increases the outstanding amount; negative reduces it. */
  outstandingChangePaise: number;
}

export interface Category {
  id: string;
  name: string;
  appliesTo: 'income' | 'expense';
  isDefault: boolean;
  status: AccountStatus;
  createdAt: string;
}

export interface Budget {
  id: string;
  name: string;
  categoryId?: string;
  alertThresholds?: BudgetAlertThreshold[];
  amountPaise: number;
  period: BudgetPeriod;
  customPeriodDays?: number;
  startsOn: string;
  endsOn?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetAlert {
  id: string;
  budgetId: string;
  periodStart: string;
  thresholdPercent: BudgetAlertThreshold;
  spentPaise: number;
  budgetAmountPaise: number;
  createdAt: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmountPaise: number;
  targetDate?: string;
  linkedAccountId?: string;
  notes?: string;
  status: SavingsGoalStatus;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SavingsGoalStatus = 'active' | 'completed' | 'archived';

export interface SavingsGoalEntry {
  id: string;
  goalId: string;
  transactionId: string;
  accountId: string;
  occurredAt: string;
  /** Positive adds to goal progress; negative records a withdrawal. */
  amountPaise: number;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}
