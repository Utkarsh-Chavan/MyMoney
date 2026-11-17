export function parseRupeesToPaise(value: string): number | null {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const amountPaise = rupees * 100 + paise;

  return Number.isSafeInteger(amountPaise) ? amountPaise : null;
}

export function formatPaise(amountPaise: number): string {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new RangeError('Money amounts must be safe integer paise.');
  }

  const amount = BigInt(amountPaise);
  const negative = amount < 0n;
  const absoluteAmount = negative ? -amount : amount;
  const rupees = absoluteAmount / 100n;
  const paise = (absoluteAmount % 100n).toString().padStart(2, '0');
  const formattedRupees = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(rupees);

  return `${negative ? '-' : ''}₹${formattedRupees}.${paise}`;
}

export function paiseToRupeesInput(amountPaise: number): string {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new RangeError('Money amounts must be non-negative safe integer paise.');
  }

  const amount = BigInt(amountPaise);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

export function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateInputToTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return `${value}T12:00:00.000Z`;
}

export function formatStoredDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
