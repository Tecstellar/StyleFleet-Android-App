import { DEFAULT_STYLIST_PERMISSIONS, ScreenName, StylistPermissions } from '../types/domain';

export type PermissionKey = keyof StylistPermissions;

/** The 8 modules a stylist can be given. The other keys are limits on top of a module. */
export type ModuleKey = Exclude<PermissionKey, 'expensesHistory' | 'reportsHistory' | 'shareBills'>;

export const MODULE_KEYS: ModuleKey[] = [
  'customers',
  'sales',
  'appointments',
  'reminders',
  'expenses',
  'reports',
  'team',
  'profile',
];

export const LIMIT_KEYS: PermissionKey[] = ['expensesHistory', 'reportsHistory', 'shareBills'];

/** Which owner-controlled permission each screen needs. Screens not listed are open to every stylist. */
export const SCREEN_PERMISSION: Partial<Record<ScreenName, ModuleKey>> = {
  customers: 'customers',
  customer: 'customers',
  sales: 'sales',
  bill: 'sales',
  invoice: 'sales',
  sent: 'sales',
  appointments: 'appointments',
  booking: 'appointments',
  reminders: 'reminders',
  bulk: 'reminders',
  bulksent: 'reminders',
  expenses: 'expenses',
  reports: 'reports',
  staff: 'team',
  profile: 'profile',
};

/** Keys missing from stored permissions fall back to the default, never to "allowed". */
export function resolvePermissions(stored?: Partial<StylistPermissions> | null): StylistPermissions {
  return { ...DEFAULT_STYLIST_PERMISSIONS, ...(stored || {}) };
}

export function requiredPermission(screen: ScreenName): ModuleKey | null {
  return SCREEN_PERMISSION[screen] ?? null;
}

/** Owners (no permissions passed) can open everything. */
export function canAccessScreen(
  screen: ScreenName,
  isStylist: boolean,
  stored?: Partial<StylistPermissions> | null
): boolean {
  if (!isStylist) return true;
  const key = requiredPermission(screen);
  if (!key) return true;
  return resolvePermissions(stored)[key] === true;
}

/** Every stored key: modules first, then limits. */
export const PERMISSION_KEYS: PermissionKey[] = [...MODULE_KEYS, ...LIMIT_KEYS];

/** Toggle order and grouping for the owner's permission sheet. */
export const PERMISSION_GROUPS: { titleKey: string; titleFallback: string; keys: PermissionKey[] }[] = [
  {
    titleKey: 'spGroupDaily',
    titleFallback: 'Daily work',
    keys: ['customers', 'sales', 'appointments', 'reminders'],
  },
  {
    titleKey: 'spGroupBusiness',
    titleFallback: 'Money, team & settings',
    keys: ['expenses', 'reports', 'team', 'profile'],
  },
  {
    titleKey: 'spGroupLimits',
    titleFallback: 'Limits',
    keys: ['expensesHistory', 'reportsHistory', 'shareBills'],
  },
];

/** Names used in the "Access Restricted" alert. */
export const STYLIST_MODULE_LABELS: Record<ModuleKey, string> = {
  customers: 'Customers',
  sales: 'Billing & Sales',
  appointments: 'Appointments',
  expenses: 'Expenses',
  reports: 'Reports',
  team: 'Team Management',
  reminders: 'Reminders & WhatsApp',
  profile: 'Salon Profile',
};

/** Permissions that expose money or control other people. */
export const SENSITIVE_PERMISSIONS: PermissionKey[] = ['expenses', 'reports', 'team', 'profile', 'expensesHistory', 'reportsHistory', 'shareBills'];

export function countAllowed(perms: StylistPermissions): number {
  return MODULE_KEYS.filter((k) => perms[k] === true).length;
}

export function samePermissions(a: StylistPermissions, b: StylistPermissions): boolean {
  return PERMISSION_KEYS.every((k) => a[k] === b[k]);
}

/** Owners always may share. A stylist needs the owner's "share bills" switch. */
export function canShareBills(isStylist: boolean, stored?: Partial<StylistPermissions> | null): boolean {
  if (!isStylist) return true;
  return resolvePermissions(stored).shareBills === true;
}

function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

/** Stylists without "expense history" only ever see today's expenses. Owners see everything. */
export function expensesVisibleTo<T extends { created_at: string }>(
  expenses: T[],
  isStylist: boolean,
  stored?: Partial<StylistPermissions> | null,
  now: Date = new Date()
): T[] {
  if (!isStylist) return expenses;
  const perms = resolvePermissions(stored);
  if (perms.expenses !== true) return [];
  if (perms.expensesHistory === true) return expenses;
  return expenses.filter((e) => isSameLocalDay(e.created_at, now));
}

/** Bills this stylist served: by id, by a line item, or by name (two stylists read "A & B"). */
function servedBy(
  b: { staff_id: string | null; staff_name: string; items?: { staff_id: string | null }[] },
  stylistId: string | null | undefined,
  stylistName: string | undefined
): boolean {
  if (stylistId && (b.staff_id === stylistId || (b.items || []).some((i) => i.staff_id === stylistId))) return true;
  const me = (stylistName || '').trim().toLowerCase();
  return !!me && (b.staff_name || '').split('&').some((n) => n.trim().toLowerCase() === me);
}

/**
 * What a stylist may see of the bills: only the ones they served today.
 * With "full reports" on (and Reports allowed) they see every bill, for the Reports screen only.
 */
export function billsVisibleTo<T extends { created_at?: string; staff_id: string | null; staff_name: string; items?: { staff_id: string | null }[] }>(
  bills: T[],
  isStylist: boolean,
  stored: Partial<StylistPermissions> | null | undefined,
  stylistId: string | null | undefined,
  stylistName: string | undefined,
  forReports = false,
  now: Date = new Date()
): T[] {
  if (!isStylist) return bills;
  const perms = resolvePermissions(stored);
  if (forReports && perms.reports === true && perms.reportsHistory === true) return bills;
  return bills.filter((b) => !!b.created_at && isSameLocalDay(b.created_at, now) && servedBy(b, stylistId, stylistName));
}

/** Every bill this stylist served, any date: their own sales history. */
export function ownBillsOf<T extends { staff_id: string | null; staff_name: string; items?: { staff_id: string | null }[] }>(
  bills: T[],
  stylistId: string | null | undefined,
  stylistName: string | undefined
): T[] {
  return bills.filter((b) => servedBy(b, stylistId, stylistName));
}
