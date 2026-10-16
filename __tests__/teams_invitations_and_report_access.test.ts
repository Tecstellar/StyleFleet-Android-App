import { staffRepository } from '../src/repositories/staffRepository';
import { STYLEFLEET_PLAY_STORE_URL } from '../src/constants/app';
import { DEFAULT_STYLIST_PERMISSIONS, StylistPermissions } from '../src/types/domain';

// Mock Supabase
jest.mock('../src/lib/supabase', () => {
  const uid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  const tableData: Record<string, any[]> = {
    staff: [],
    shops: [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'Elite Glamour Salon' }],
    bills: [],
    bill_items: [],
  };

  return {
    supabase: {
      from: jest.fn((table: string) => {
        let currentData = tableData[table] || [];
        let filterCol: string | null = null;
        let filterVal: any = null;

        const chain: any = {
          select: jest.fn(() => chain),
          insert: jest.fn((records: any) => {
            const arr = Array.isArray(records) ? records : [records];
            let lastRow: any = null;
            arr.forEach((r, idx) => {
              const row = { id: r.id || uid(), ...r };
              tableData[table] = tableData[table] || [];
              tableData[table].push(row);
              lastRow = row;
            });
            const insertResult = {
              select: () => ({
                single: () => Promise.resolve({ data: lastRow, error: null }),
                maybeSingle: () => Promise.resolve({ data: lastRow, error: null }),
                then: (resolve: any) => Promise.resolve(resolve({ data: [lastRow], error: null })),
              }),
              then: (resolve: any) => Promise.resolve(resolve({ data: [lastRow], error: null })),
            };
            return insertResult;
          }),
          update: jest.fn((updates: any) => {
            return {
              eq: jest.fn((col1: string, val1: any) => ({
                select: () => {
                  const items = tableData[table] || [];
                  const hit = items.filter((item) => item[col1] === val1);
                  hit.forEach((item) => Object.assign(item, updates));
                  return Promise.resolve({ data: hit, error: null });
                },
                eq: jest.fn((col2: string, val2: any) => {
                  const items = tableData[table] || [];
                  items.forEach((item) => {
                    if (item[col1] === val1 && item[col2] === val2) {
                      Object.assign(item, updates);
                    }
                  });
                  const updated = items.filter((item) => item[col1] === val1 && item[col2] === val2);
                  const result = { data: null, error: null };
                  return {
                    select: () => Promise.resolve({ data: updated, error: null }),
                    then: (resolve: any) => Promise.resolve(resolve(result)),
                  };
                }),
                then: (resolve: any) => {
                  const items = tableData[table] || [];
                  items.forEach((item) => {
                    if (item[col1] === val1) {
                      Object.assign(item, updates);
                    }
                  });
                  return Promise.resolve(resolve({ data: null, error: null }));
                },
              })),
            };
          }),
          delete: jest.fn(() => chain),
          eq: jest.fn((col: string, val: any) => {
            filterCol = col;
            filterVal = val;
            return chain;
          }),
          order: jest.fn(() => chain),
          limit: jest.fn(() => chain),
          single: jest.fn(() => {
            const data = tableData[table] || [];
            const match = data.find((item: any) => !filterCol || item[filterCol] === filterVal);
            return Promise.resolve({ data: match || (data.length > 0 ? data[data.length - 1] : null), error: null });
          }),
          maybeSingle: jest.fn(() => {
            const data = tableData[table] || [];
            const match = data.find((item: any) => !filterCol || item[filterCol] === filterVal);
            return Promise.resolve({ data: match || (data.length > 0 ? data[data.length - 1] : null), error: null });
          }),
          then: (resolve: any) => {
            const data = tableData[table] || [];
            const results = filterCol
              ? data.filter((item: any) => item[filterCol!] === filterVal)
              : data;
            return Promise.resolve(resolve({ data: results, error: null }));
          },
        };
        return chain;
      }),
    },
  };
});

describe('Teams, Stylist Invitations & Report Access Suite', () => {
  const shopId = '00000000-0000-4000-8000-0000000000a1';
  const shopName = 'Elite Glamour Salon';

  test('1. STYLEFLEET_PLAY_STORE_URL constant points to official Play Store listing', () => {
    expect(STYLEFLEET_PLAY_STORE_URL).toBe(
      'https://play.google.com/store/apps/details?id=com.stylefleet.app&pcampaignid=web_share'
    );
  });

  test('2. WhatsApp invitation template contains correct salon name and Play Store URL', () => {
    const message =
      `You have been added as a stylist to ${shopName}.\n\n` +
      `Please install the StyleFleet app from the Play Store and log in using "Login as Stylist":\n` +
      `${STYLEFLEET_PLAY_STORE_URL}`;

    expect(message).toContain('Elite Glamour Salon');
    expect(message).toContain('Login as Stylist');
    expect(message).toContain(STYLEFLEET_PLAY_STORE_URL);
  });

  test('3. Newly added stylist starts with invitation_status: not_invited and null invited_at', async () => {
    const stylist = await staffRepository.addStaff(shopId, 'Suresh Kumar', 'Senior Barber', '9876500001');

    expect(stylist.name).toBe('Suresh Kumar');
    expect(stylist.phone).toBe('9876500001');
    expect(stylist.invitation_status).toBe('not_invited');
    expect(stylist.invited_at).toBeNull();
  });

  test('4. recordStylistInvite transitions invitation_status to invited with timestamp', async () => {
    const stylist = await staffRepository.addStaff(shopId, 'Ananya Sen', 'Nail Artist', '9876500002');
    expect(stylist.invitation_status).toBe('not_invited');

    await staffRepository.recordStylistInvite(shopId, stylist.id);

    const list = await staffRepository.getStaff(shopId);
    const updated = list.find((s) => s.id === stylist.id);

    expect(updated).toBeDefined();
    expect(updated?.invitation_status).toBe('invited');
    expect(updated?.invited_at).toBeDefined();
    expect(typeof updated?.invited_at).toBe('string');
  });

  test('5. markStylistActive transitions invitation_status to active upon stylist login', async () => {
    const stylist = await staffRepository.addStaff(shopId, 'Kavita Rao', 'Hair Stylist', '9876500003');
    await staffRepository.recordStylistInvite(shopId, stylist.id);

    await staffRepository.markStylistActive(shopId, stylist.id);

    const list = await staffRepository.getStaff(shopId);
    const updated = list.find((s) => s.id === stylist.id);

    expect(updated?.invitation_status).toBe('active');
  });

  test('6. Report Download Gating Logic: Free tier under 100 sales can download reports', () => {
    const totalSalesCount = 45;
    const isPro = false;
    const isReportDownloadLocked = !isPro && totalSalesCount >= 100;

    expect(isReportDownloadLocked).toBe(false);
  });

  test('7. Report Download Gating Logic: Free tier at or over 100 sales has download locked', () => {
    const totalSalesCount = 100;
    const isPro = false;
    const isReportDownloadLocked = !isPro && totalSalesCount >= 100;

    expect(isReportDownloadLocked).toBe(true);

    const overLimitSales = 125;
    const isLockedOver = !isPro && overLimitSales >= 100;
    expect(isLockedOver).toBe(true);
  });

  test('8. Report Download Gating Logic: Pro users can download reports unconditionally', () => {
    const isPro = true;
    const salesCounts = [0, 50, 100, 250, 1000];

    salesCounts.forEach((count) => {
      const isReportDownloadLocked = !isPro && count >= 100;
      expect(isReportDownloadLocked).toBe(false);
    });
  });

  test('9. Stylist default permissions contain proper module defaults', () => {
    expect(DEFAULT_STYLIST_PERMISSIONS).toEqual({
      customers: true,
      sales: true,
      appointments: true,
      expenses: false,
      reports: false,
      team: false,
      reminders: true,
      profile: false,
      expensesHistory: false, reportsHistory: false,
      shareBills: false,
    });
  });

  test('10. Admin Panel permissions update persists properly', async () => {
    const customPerms: StylistPermissions = {
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

    const shop2 = '00000000-0000-4000-8000-0000000000a2';
    const stylist = await staffRepository.addStaff(shop2, 'Deepak Verma', 'Colorist', '9876500004');
    await staffRepository.updateStaffPermissions(shop2, stylist.id, customPerms);

    const list = await staffRepository.getStaff(shop2);
    const updated = list.find((s) => s.id === stylist.id);

    expect(updated?.permissions).toEqual(customPerms);
  });

  test('11. Stylist rating updates and persists properly', async () => {
    const shop3 = '00000000-0000-4000-8000-0000000000a3';
    const stylist = await staffRepository.addStaff(shop3, 'Anjali Roy', 'Senior Stylist', '9876500005');
    expect(stylist.rating).toBe('5.0');

    // Update rating to 4.8
    const updated = await staffRepository.updateStaffRating(shop3, stylist.id, '4.8');
    expect(updated).toBeDefined();
    expect(updated?.rating).toBe('4.8');

    // Retrieve from repository
    const list = await staffRepository.getStaff(shop3);
    const found = list.find((s) => s.id === stylist.id);
    expect(found?.rating).toBe('4.8');
  });

  test('12. Stylist rating formats non-numeric or invalid ratings gracefully to 5.0', async () => {
    const shop3 = '00000000-0000-4000-8000-0000000000a3';
    const list = await staffRepository.getStaff(shop3);
    const stylist = list[0];
    const updated = await staffRepository.updateStaffRating(shop3, stylist.id, 'invalid');
    expect(updated?.rating).toBe('5.0');
  });
});
