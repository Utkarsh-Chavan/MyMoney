import type { AccountType } from '../../core/models/finance.models';

export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case 'savings-bank':
      return 'Savings bank';
    case 'current-bank':
      return 'Current bank';
    case 'cash-wallet':
      return 'Cash wallet';
    case 'digital-wallet':
      return 'Digital wallet';
    case 'other':
      return 'Other';
  }
}
