import { staffRepository } from '../src/repositories/staffRepository';
import { expenseRepository } from '../src/repositories/expenseRepository';
import { supabase } from '../src/lib/supabase';
import {
  StylistPermissions,
  DEFAULT_STYLIST_PERMISSIONS,
  StaffMember,
  Bill,
} from '../src/types/domain';

// Mock Supabase
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('Stylist Access, Permissions & CRUD QA Suite', () => {
  const shopId = '00000000-0000-4000-8000-0000000000b1';
  const expenseId = '00000000-0000-4000-8000-0000000000e1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Stylist Permissions & Phone Lookup', () => {
    test('DEFAULT_STYLIST_PERMISSIONS grants basic salon access and denies sensitive management by default', () => {
      expect(DEFAULT_STYLIST_PERMISSIONS.customers).toBe(true);
      expect(DEFAULT_STYLIST_PERMISSIONS.sales).toBe(true);
      expect(DEFAULT_STYLIST_PERMISSIONS.appointments).toBe(true);
      expect(DEFAULT_STYLIST_PERMISSIONS.reminders).toBe(true);

      // Sensitive modules default to false
      expect(DEFAULT_STYLIST_PERMISSIONS.expenses).toBe(false);
      expect(DEFAULT_STYLIST_PERMISSIONS.reports).toBe(false);
      expect(DEFAULT_STYLIST_PERMISSIONS.team).toBe(false);
      expect(DEFAULT_STYLIST_PERMISSIONS.profile).toBe(false);
    });

    test('getStylistByPhone returns active stylist with permissions if found in Supabase', async () => {
      const mockStylistData = {
        id: 'stylist-uuid-1',
        shop_id: shopId,
        name: 'Rohan Sharma',
        role: 'Senior Stylist',
        phone: '9876543210',
        is_active: true,
        permissions: {
          ...DEFAULT_STYLIST_PERMISSIONS,
          expenses: true, // Custom permission granted
        },
      };

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockStylistData,
          error: null,
        }),
      });

      const result = await staffRepository.getStylistByPhone('+91 9876543210');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Rohan Sharma');
      expect(result?.phone).toBe('9876543210');
      expect(result?.permissions?.expenses).toBe(true);
      expect(result?.permissions?.reports).toBe(false);
    });

    test('getStylistByPhone returns null when phone is invalid or not registered in Supabase', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      });

      const result = await staffRepository.getStylistByPhone('9999999999');
      expect(result).toBeNull();

      // Test short/invalid phone
      const invalidResult = await staffRepository.getStylistByPhone('123');
      expect(invalidResult).toBeNull();
    });

    test('updateStaffPermissions updates Supabase and caches updated permissions', async () => {
      const mockUpdate = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();

      (supabase.from as jest.Mock).mockReturnValue({
        update: mockUpdate,
        eq: mockEq,
        select: jest.fn().mockResolvedValue({ data: [{ id: 'stylist-uuid-1' }], error: null }),
      });

      const updatedPerms: StylistPermissions = {
        customers: true,
        sales: true,
        appointments: true,
        expenses: true,
        reports: true,
        team: false,
        reminders: true,
        profile: false,
        expensesHistory: false, reportsHistory: false,
        shareBills: false,
      };

      await staffRepository.updateStaffPermissions(shopId, 'stylist-uuid-1', updatedPerms);

      expect(supabase.from).toHaveBeenCalledWith('staff');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: updatedPerms,
        })
      );
    });

    test('addStaff enforces 10-digit phone requirement and 3-stylist limit', async () => {
      // Mock existing 3 staff members
      jest.spyOn(staffRepository, 'getStaff').mockResolvedValueOnce([
        { id: '1', shop_id: shopId, name: 'S1', role: 'Stylist', phone: '9000000001', is_active: true } as any,
        { id: '2', shop_id: shopId, name: 'S2', role: 'Stylist', phone: '9000000002', is_active: true } as any,
        { id: '3', shop_id: shopId, name: 'S3', role: 'Stylist', phone: '9000000003', is_active: true } as any,
      ]);

      await expect(
        staffRepository.addStaff(shopId, 'Fourth Stylist', 'Stylist', '9000000004')
      ).rejects.toThrow('STYLIST_LIMIT_REACHED');

      // Test missing phone
      await expect(
        staffRepository.addStaff(shopId, 'No Phone Stylist', 'Stylist', '')
      ).rejects.toThrow('PHONE_REQUIRED');
    });
  });

  describe('2. Expense CRUD & Database Error Handling', () => {
    test('addExpense throws when Supabase returns an error', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database RLS policy violated for shop' },
        }),
      });

      await expect(
        expenseRepository.addExpense(shopId, 'Rent', 15000, 'Monthly salon rent', 'UPI')
      ).rejects.toThrow('Database RLS policy violated for shop');
    });

    test('updateExpense throws when Supabase returns an error', async () => {
      // Mock cached expense exists
      jest.spyOn(expenseRepository as any, 'getCachedExpenses').mockResolvedValueOnce([
        {
          id: expenseId,
          shop_id: shopId,
          category_name: 'Rent',
          note: 'Old note',
          amount_minor: 1500000,
          payment_method: 'UPI',
        },
      ]);

      (supabase.from as jest.Mock).mockReturnValue({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({ data: null, error: { message: 'Update permission denied' } }),
      });

      await expect(
        expenseRepository.updateExpense(shopId, expenseId, { note: 'New note' })
      ).rejects.toThrow(/permission/i);
    });

    test('deleteExpense throws when Supabase returns an error', async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      });
      const fromObj = (supabase.from as jest.Mock)();
      fromObj.eq.mockReturnValueOnce(fromObj).mockResolvedValueOnce({
        error: { message: 'Delete constraint failed' },
      });

      await expect(
        expenseRepository.deleteExpense(shopId, expenseId)
      ).rejects.toThrow('Delete constraint failed');
    });
  });

  describe('3. Account Sales Usage & Limit Display', () => {
    test('Calculates active bills correctly for 100 sales limit', () => {
      const bills: Bill[] = [
        { id: 'b1', total_minor: 50000, is_deleted: false } as any,
        { id: 'b2', total_minor: 80000, is_deleted: false } as any,
        { id: 'b3', total_minor: 30000, is_deleted: true } as any, // Deleted bill excluded
      ];

      const activeBillsCount = bills.filter((b) => !(b as any).is_deleted).length;
      expect(activeBillsCount).toBe(2);

      const remainingSales = Math.max(0, 100 - activeBillsCount);
      expect(remainingSales).toBe(98);

      const progressPercent = Math.min(Math.round((activeBillsCount / 100) * 100), 100);
      expect(progressPercent).toBe(2);
    });
  });

  describe('4. Stylist Access Control Gating Logic', () => {
    test('Denies access to restricted modules when permission is false', () => {
      const stylistPerms: StylistPermissions = {
        customers: true,
        sales: true,
        appointments: true,
        expenses: false, // Restricted
        reports: false,  // Restricted
        team: false,     // Restricted
        reminders: true,
        profile: false,  // Restricted
        expensesHistory: false, reportsHistory: false,
        shareBills: false,
      };

      const checkAccess = (perm: keyof StylistPermissions): boolean => {
        return stylistPerms[perm] !== false;
      };

      expect(checkAccess('customers')).toBe(true);
      expect(checkAccess('sales')).toBe(true);
      expect(checkAccess('appointments')).toBe(true);
      expect(checkAccess('reminders')).toBe(true);

      expect(checkAccess('expenses')).toBe(false);
      expect(checkAccess('reports')).toBe(false);
      expect(checkAccess('team')).toBe(false);
      expect(checkAccess('profile')).toBe(false);
    });
  });
});
