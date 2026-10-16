/**
 * Domain types for Salon OS
 * Used across hooks, services, repositories, and UI screens
 */

export type Period = 'Day' | 'Week' | 'Month';

export type ScreenName =
  | 'splash'
  | 'welcomeTour'
  | 'phone'
  | 'otp'
  | 'register'
  | 'workers'
  | 'home'
  | 'customers'
  | 'customer'
  | 'sales'
  | 'bill'
  | 'invoice'
  | 'sent'
  | 'accounts'
  | 'expenses'
  | 'appointments'
  | 'booking'
  | 'reminders'
  | 'bulk'
  | 'bulksent'
  | 'staff'
  | 'pricing'
  | 'profile'
  | 'reports';

export type MainTab = 'home' | 'customers' | 'sales' | 'accounts';

export interface Customer {
  id: string;
  shop_id: string;
  name: string;
  phone: string;
  notes: string | null;
  preferred_staff_id: string | null;
  preferred_stylist_name?: string;
  is_starred: boolean;
  visits_count: number;
  lifetime_spend_minor: number;
  outstanding_due_minor: number;
  last_visit_date: string | null;
  due_start_date?: string | null;
  created_at: string;
  is_active?: boolean;
}

export interface StylistPermissions {
  customers: boolean;
  sales: boolean;
  appointments: boolean;
  expenses: boolean;
  reports: boolean;
  team: boolean;
  reminders: boolean;
  profile: boolean;
  /** With `expenses` on: may also see expenses from before today. Off = today only. */
  expensesHistory: boolean;
  /** With `reports` on: may see the whole shop's reports and history. Off = only their own sales from today. */
  reportsHistory: boolean;
  /** May send a bill to a customer (WhatsApp / PDF). */
  shareBills: boolean;
}

export const DEFAULT_STYLIST_PERMISSIONS: StylistPermissions = {
  customers: true,
  sales: true,
  appointments: true,
  expenses: false,
  reports: false,
  team: false,
  reminders: true,
  profile: false,
  expensesHistory: false,
  reportsHistory: false,
  shareBills: false,
};

export interface StaffMember {
  id: string;
  shop_id: string;
  name: string;
  role: string;
  phone: string | null;
  is_active: boolean;
  permissions?: StylistPermissions;
  invitation_status?: 'not_invited' | 'invited' | 'active';
  invited_at?: string | null;
  target_amount_minor: number;
  revenue_minor: number;
  service_count: number;
  rebook_rate: string;
  rating: string;
  chair_utilization: string;
}

export interface ServiceCategory {
  id: string;
  shop_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Service {
  id: string;
  shop_id: string;
  category_id: string | null;
  category_name?: string;
  name: string;
  price_minor: number;
  duration_minutes: number;
  is_active: boolean;
}

export interface Offer {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  conditions: Record<string, any>;
  is_active: boolean;
}

export type AppointmentStatus =
  | 'Not confirmed'
  | 'Confirmed'
  | 'In chair'
  | 'Done'
  | 'Cancelled';

export interface Appointment {
  id: string;
  shop_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone?: string | null;
  staff_id: string | null;
  staff_name: string;
  service_id: string | null;
  service_ids?: string[] | null;
  service_name: string;
  starts_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  notes: string | null;
  amount_minor: number;
  created_at: string;
  is_edited?: boolean;
  edited_at?: string;
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by_role?: 'owner' | 'stylist';
  deleted_by_name?: string;
}

export interface BillItem {
  id?: string;
  service_id: string | null;
  service_name_snapshot: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  line_total_minor: number;
  staff_id: string | null;
}

export interface BillPayment {
  id?: string;
  amount_minor: number;
  method: string;
  paid_at: string;
  status?: string;
  reference?: string;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  website?: string;
}

export interface Bill {
  id: string;
  shop_id: string;
  customer_id: string | null;
  customer_name: string;
  staff_id: string | null;
  staff_name: string;
  invoice_number: string;
  status: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  tip_minor?: number;
  total_minor: number;
  paid_amount_minor?: number;
  due_amount_minor?: number;
  notes: string | null;
  issued_at: string;
  created_at?: string;
  payment_method: string;
  items: BillItem[];
  payments?: BillPayment[];
  deleted_at?: string | null;
  deleted_by?: string;
  deleted_by_role?: 'owner' | 'stylist';
  pdf_url?: string | null;
  is_edited?: boolean;
  reminder_status?: 'Not Sent' | 'Sent' | 'Pending';
  confirmation_status?: 'Pending' | 'Confirmed';
}

export type InvoiceNumberingMode = 'monthly' | 'yearly';

export interface FestivalOfferTemplate {
  id: string;
  category: string;
  title: string;
  defaultOffer: string;
  templateBody: string;
  validityHint: string;
}

export interface Expense {
  id: string;
  shop_id: string;
  category_id: string | null;
  category_name: string;
  note: string;
  amount_minor: number;
  payment_method: string;
  expense_date: string;
  created_at: string;
  /** false = listed but not subtracted from profit. Missing means it counts. */
  include_in_profit?: boolean;
  /** Team member this expense is for (salary, advance...). null / missing = ordinary shop expense. */
  staff_id?: string | null;
}

export interface ReminderItem {
  id: string;
  group: 'Today' | 'Upcoming';
  kind: 'appt' | 'money' | 'close' | 'support';
  title: string;
  sub: string;
  when: string;
  action: string;
  reference_id?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  amount_minor?: number;
  starts_at?: string;
}

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'expired'
  | 'payment_pending'
  | 'payment_failed'
  | 'cancelled';

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  shop_id: string | null;
  plan_id: string;
  status: SubscriptionStatus;
  trial_start_date: string | null;
  trial_end_date: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  cashfree_order_id: string | null;
  cashfree_payment_id: string | null;
  amount_minor: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export type SubscriptionStateCategory =
  | 'TRIAL_ACTIVE'
  | 'TRIAL_EXPIRING_SOON'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE_SUBSCRIPTION';

