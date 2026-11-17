# MyMoney

MyMoney is a local-first personal finance application. The initial foundation uses standalone
Angular 21, TypeScript, Tailwind CSS v4, Dexie/IndexedDB, Lucide icons, and Angular's service
worker support.

## Development

```sh
npm install
npm start
```

The development server is available at `http://localhost:4200/`. Angular's service worker is
disabled in development mode.

## Production build

```sh
npm run build
```

The production build includes the Angular service worker and its generated cache manifest.
This configures offline app-shell caching; offline behavior has not yet been validated in an
installed browser.

## Foundation structure

- `src/app/core/models/finance.models.ts` defines the initial finance and ledger record types.
- `src/app/core/database/mymoney.database.ts` defines the versioned IndexedDB schema and migrates existing account records.
- `src/app/core/services/theme.service.ts` manages the light/dark theme preference.
- `src/app/core/services/accounts.service.ts` validates account creation, editing, archival, and protected deletion.
- `src/app/core/services/account-balance.service.ts` derives balances and history from ledger entries.
- `src/app/core/services/account-transfers.service.ts` records transfers and both ledger entries in one IndexedDB transaction.
- `src/app/features/accounts/` contains account overview, create/edit, details, and transfer screens.
- Account routes are lazy-loaded; the remaining finance sections are still feature placeholders.

Account opening balances and dates are locked after ledger activity to protect the calculated
balance history. Archived accounts retain their records and cannot be selected for new
transfers. Account deletion is rejected when transaction or ledger records exist. No sample
financial records are created.

## Account tests

```sh
npm test
```

Tests use `fake-indexeddb` with uniquely named temporary databases; they do not touch the
application database. They cover account CRUD safeguards, ledger balances, transfers,
rollback on a failed ledger write, migration, and persistence after reopening IndexedDB.
