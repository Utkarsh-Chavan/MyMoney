import type { PaymentMethod, TransactionType } from '../../core/models/finance.models';

export function transactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'income':
      return 'Income';
    case 'expense':
      return 'Expense';
    case 'transfer':
      return 'Transfer';
    case 'savings-contribution':
      return 'Savings contribution';
    case 'savings-withdrawal':
      return 'Savings withdrawal';
    case 'money-lent':
      return 'Money lent';
    case 'money-borrowed':
      return 'Money borrowed';
    case 'loan-repayment-received':
      return 'Repayment received';
    case 'loan-repayment-made':
      return 'Repayment made';
  }
}

export function paymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'card':
      return 'Card';
    case 'bank-transfer':
      return 'Bank transfer';
    case 'upi':
      return 'UPI';
    case 'other':
      return 'Other';
  }
}
