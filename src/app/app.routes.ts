import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((module) => module.DashboardComponent),
    title: 'Overview · MyMoney',
  },
  {
    path: 'accounts/new',
    loadComponent: () => import('./features/accounts/account-form.component').then((module) => module.AccountFormComponent),
    title: 'Add account · MyMoney',
  },
  {
    path: 'accounts/transfer',
    loadComponent: () => import('./features/accounts/account-transfer.component').then((module) => module.AccountTransferComponent),
    title: 'Transfer · MyMoney',
  },
  {
    path: 'accounts/:accountId/edit',
    loadComponent: () => import('./features/accounts/account-form.component').then((module) => module.AccountFormComponent),
    title: 'Edit account · MyMoney',
  },
  {
    path: 'accounts/:accountId',
    loadComponent: () => import('./features/accounts/account-details.component').then((module) => module.AccountDetailsComponent),
    title: 'Account details · MyMoney',
  },
  {
    path: 'accounts',
    loadComponent: () => import('./features/accounts/accounts.component').then((module) => module.AccountsComponent),
    title: 'Accounts · MyMoney',
  },
  {
    path: 'transactions/quick',
    loadComponent: () => import('./features/transactions/transaction-form.component').then((module) => module.TransactionFormComponent),
    data: { entryMode: 'quick' },
    title: 'Quick add · MyMoney',
  },
  {
    path: 'transactions/new',
    loadComponent: () => import('./features/transactions/transaction-form.component').then((module) => module.TransactionFormComponent),
    data: { entryMode: 'detailed' },
    title: 'Add transaction · MyMoney',
  },
  {
    path: 'transactions/categories',
    loadComponent: () => import('./features/transactions/categories.component').then((module) => module.CategoriesComponent),
    title: 'Categories · MyMoney',
  },
  {
    path: 'transactions/:transactionId/edit',
    loadComponent: () => import('./features/transactions/transaction-form.component').then((module) => module.TransactionFormComponent),
    title: 'Edit transaction · MyMoney',
  },
  {
    path: 'transactions/:transactionId',
    loadComponent: () => import('./features/transactions/transaction-details.component').then((module) => module.TransactionDetailsComponent),
    title: 'Transaction details · MyMoney',
  },
  {
    path: 'transactions',
    loadComponent: () => import('./features/transactions/transactions.component').then((module) => module.TransactionsComponent),
    title: 'Transactions · MyMoney',
  },
  {
    path: 'loans',
    loadComponent: () => import('./features/loans/loans.component').then((module) => module.LoansComponent),
    title: 'Loans & debts · MyMoney',
  },
  {
    path: 'loans/new',
    loadComponent: () => import('./features/loans/loan-form.component').then((module) => module.LoanFormComponent),
    title: 'Record a loan · MyMoney',
  },
  {
    path: 'loans/people/new',
    loadComponent: () => import('./features/loans/person-form.component').then((module) => module.PersonFormComponent),
    title: 'Add a person · MyMoney',
  },
  {
    path: 'loans/people/:personId/edit',
    loadComponent: () => import('./features/loans/person-form.component').then((module) => module.PersonFormComponent),
    title: 'Edit person · MyMoney',
  },
  {
    path: 'loans/people/:personId',
    loadComponent: () => import('./features/loans/person-details.component').then((module) => module.PersonDetailsComponent),
    title: 'Person details · MyMoney',
  },
  {
    path: 'loans/:loanId/edit',
    loadComponent: () => import('./features/loans/loan-form.component').then((module) => module.LoanFormComponent),
    title: 'Edit loan · MyMoney',
  },
  {
    path: 'loans/:loanId',
    loadComponent: () => import('./features/loans/loan-details.component').then((module) => module.LoanDetailsComponent),
    title: 'Loan details · MyMoney',
  },
  {
    path: 'budgets/new',
    loadComponent: () => import('./features/budgets/budget-form.component').then((module) => module.BudgetFormComponent),
    title: 'Create budget · MyMoney',
  },
  {
    path: 'budgets/:budgetId/edit',
    loadComponent: () => import('./features/budgets/budget-form.component').then((module) => module.BudgetFormComponent),
    title: 'Edit budget · MyMoney',
  },
  {
    path: 'budgets',
    loadComponent: () => import('./features/budgets/budgets.component').then((module) => module.BudgetsComponent),
    title: 'Budgets · MyMoney',
  },
  {
    path: 'savings/new',
    loadComponent: () => import('./features/savings/savings-goal-form.component').then((module) => module.SavingsGoalFormComponent),
    title: 'Create savings goal · MyMoney',
  },
  {
    path: 'savings/:goalId/edit',
    loadComponent: () => import('./features/savings/savings-goal-form.component').then((module) => module.SavingsGoalFormComponent),
    title: 'Edit savings goal · MyMoney',
  },
  {
    path: 'savings/:goalId',
    loadComponent: () => import('./features/savings/savings-goal-details.component').then((module) => module.SavingsGoalDetailsComponent),
    title: 'Savings goal details · MyMoney',
  },
  {
    path: 'savings',
    loadComponent: () => import('./features/savings/savings.component').then((module) => module.SavingsComponent),
    title: 'Savings goals · MyMoney',
  },
  {
    path: 'reports',
    loadComponent: () => import('./features/reports/reports.component').then((module) => module.ReportsComponent),
    title: 'Reports · MyMoney',
  },
  {
    path: 'calculator',
    loadComponent: () => import('./features/calculator/financial-calculator.component').then((module) => module.FinancialCalculatorComponent),
    title: 'Calculator · MyMoney',
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/security/security-settings.component').then((module) => module.SecuritySettingsComponent),
    title: 'Settings · MyMoney',
  },
  { path: '**', redirectTo: '' },
];
