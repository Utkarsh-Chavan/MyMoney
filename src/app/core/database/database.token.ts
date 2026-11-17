import { InjectionToken } from '@angular/core';
import { myMoneyDatabase, type MyMoneyDatabase } from './mymoney.database';

export const MY_MONEY_DATABASE = new InjectionToken<MyMoneyDatabase>('MY_MONEY_DATABASE', {
  providedIn: 'root',
  factory: () => myMoneyDatabase,
});
