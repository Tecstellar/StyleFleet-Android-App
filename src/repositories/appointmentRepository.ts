import { supabase } from '../lib/supabase';
import { assertSaved, isRemoteShop } from '../utils/persist';
import { isValidUuid } from '../utils/uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appointment, AppointmentStatus } from '../types/domain';

const STORAGE_KEY_APPTS = '@salon_os_appts_cache';

/**
 * starts_at is a timestamptz column but we save the salon's wall-clock text ("2026-10-15 8:00 PM"),
 * which the database keeps as that same clock time in UTC. Read it back as the same clock text,
 * not shifted into the phone's time zone.
 */
const dbWallClock = (startsAt: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\+00(?::?00)?)$/.exec(startsAt || '');
  if (!m) return startsAt;
  const h = parseInt(m[2], 10);
  return `${m[1]} ${h % 12 === 0 ? 12 : h % 12}:${m[3]} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const STANDARD_SLOTS = [
  '9:30', '10:00', '10:30', '11:00', '11:30', '12:00',
  '2:00', '2:30', '3:00', '4:00', '4:30', '5:30'
] as const;

export class AppointmentRepository {
  /**
   * Fetch all real appointments for a shop from Supabase
   */
  async getAppointments(shopId: string, dayIndex = 1): Promise<Appointment[]> {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers(name, phone), staff(name), services(name, price_minor)')
        .eq('shop_id', shopId)
        .order('starts_at', { ascending: true });

      if (!error && data) {
        const mapped: Appointment[] = data.map((a) => {
          let serviceIds: string[] | undefined;
          let isEdited = false;
          let editedAt: string | undefined;
          let isDeleted = false;
          let deletedAt: string | undefined;
          let deletedByRole: 'owner' | 'stylist' | undefined;
          let deletedByName: string | undefined;

          if (a.notes) {
            try {
              const parsed = JSON.parse(a.notes);
              if (Array.isArray(parsed?.service_ids) && parsed.service_ids.length > 0) {
                serviceIds = parsed.service_ids;
              }
              if (parsed?.is_edited) isEdited = true;
              if (parsed?.edited_at) editedAt = parsed.edited_at;
              if (parsed?.is_deleted) isDeleted = true;
              if (parsed?.deleted_at) deletedAt = parsed.deleted_at;
              if (parsed?.deleted_by_role) deletedByRole = parsed.deleted_by_role;
              if (parsed?.deleted_by_name) deletedByName = parsed.deleted_by_name;
            } catch {
              // notes is standard string
            }
          }
          if (!serviceIds && a.service_id) {
            serviceIds = [a.service_id];
          }

          return {
            id: a.id,
            shop_id: a.shop_id,
            customer_id: a.customer_id,
            customer_name: (a.customers as any)?.name || 'Customer',
            customer_phone: (a.customers as any)?.phone,
            staff_id: a.staff_id,
            staff_name: (() => {
              if (a.notes) {
                try {
                  const parsed = JSON.parse(a.notes);
                  if (parsed && parsed.staff_name) return parsed.staff_name;
                } catch {}
              }
              return (a.staff as any)?.name || 'Stylist';
            })(),
            service_id: a.service_id,
            service_ids: serviceIds,
            service_name: (a.services as any)?.name || 'Service',
            starts_at: dbWallClock(a.starts_at),
            duration_minutes: a.duration_minutes,
            status: a.status as AppointmentStatus,
            notes: a.notes,
            amount_minor: (a.services as any)?.price_minor || 0,
            created_at: a.created_at,
            is_edited: isEdited,
            edited_at: editedAt,
            is_deleted: isDeleted,
            deleted_at: deletedAt,
            deleted_by_role: deletedByRole,
            deleted_by_name: deletedByName,
          };
        });
        await this.cacheAppointments(shopId, mapped);
        return mapped;
      }
    } catch {
      console.warn('AppointmentRepository: Offline fallback active');
    }

    const cached = await this.getCachedAppointments(shopId);
    return cached || [];
  }

  /**
   * Add a real appointment and persist directly to Supabase
   */
  async addAppointment(params: {
    shopId: string;
    customerName: string;
    customerId?: string | null;
    customerPhone?: string | null;
    serviceName: string;
    serviceId?: string | null;
    serviceIds?: string[] | null;
    stylistName: string;
    stylistId?: string | null;
    stylistIds?: string[];
    serviceQuantities?: Record<string, number>;
    durationMinutes?: number;
    slot: string;
    dateStr?: string;
    amountRupees: number;
    sendConfirm?: boolean;
  }): Promise<Appointment> {
    const {
      shopId,
      customerName,
      customerId = null,
      customerPhone = null,
      serviceName,
      serviceId = null,
      serviceIds = null,
      stylistName,
      stylistId = null,
      slot,
      dateStr,
      amountRupees,
      sendConfirm = true,
      durationMinutes = 45,
    } = params;

    const startsAtDisplay = dateStr ? `${dateStr} ${slot}` : slot;
    const resolvedServiceIds =
      serviceIds && serviceIds.length > 0
        ? serviceIds
        : serviceId
        ? [serviceId]
        : [];

    const notesPayload = JSON.stringify({
      notes: customerId ? null : customerName,
      service_ids: resolvedServiceIds,
      service_quantities: params.serviceQuantities || undefined,
      staff_name: stylistName,
      staff_ids: params.stylistIds || undefined,
    });

    const newAppt: Appointment = {
      id: `appt_${Date.now()}`,
      shop_id: shopId,
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      staff_id: stylistId,
      staff_name: stylistName,
      service_id: serviceId,
      service_ids: resolvedServiceIds,
      service_name: serviceName,
      starts_at: startsAtDisplay,
      duration_minutes: durationMinutes,
      status: 'Confirmed',
      notes: notesPayload,
      amount_minor: Math.round(amountRupees * 100),
      created_at: new Date().toISOString(),
    };

    if (isRemoteShop(shopId)) {
      const payload: any = {
        shop_id: shopId,
        starts_at: startsAtDisplay,
        duration_minutes: durationMinutes,
        status: 'Confirmed',
        notes: notesPayload,
      };

      if (isValidUuid(customerId)) payload.customer_id = customerId;
      if (isValidUuid(stylistId)) payload.staff_id = stylistId;
      if (isValidUuid(serviceId)) payload.service_id = serviceId;

      const saved = await supabase.from('appointments').insert(payload).select().single();
      assertSaved(saved, 'the appointment');
      if (!saved.data) throw new Error('The appointment could not be saved. Please try again.');
      newAppt.id = saved.data.id;
    }

    const current = (await this.getCachedAppointments(shopId)) || [];
    const updated = [newAppt, ...current];
    await this.cacheAppointments(shopId, updated);
    return newAppt;
  }

  /**
   * Update appointment status
   */
  async updateStatus(
    shopId: string,
    apptId: string,
    newStatus: AppointmentStatus
  ): Promise<void> {
    // Save first. The phone's copy changes only once the database has it.
    if (isRemoteShop(shopId) && isValidUuid(apptId)) {
      const result = await supabase
        .from('appointments')
        .update({ status: newStatus } as any)
        .eq('id', apptId)
        .select('id');
      assertSaved(result, 'the appointment status');
      if (!result.data || result.data.length === 0) {
        throw new Error('This appointment was not found on the server, so the status was not saved.');
      }
    }

    const current = (await this.getCachedAppointments(shopId)) || [];
    const target = current.find((a) => a.id === apptId);
    if (target) {
      target.status = newStatus;
      await this.cacheAppointments(shopId, current);
    }
  }

  /**
   * Advance appointment to next lifecycle status
   */
  async advanceStatus(shopId: string, apptId: string): Promise<AppointmentStatus | null> {
    const current = (await this.getCachedAppointments(shopId)) || [];
    const target = current.find((a) => a.id === apptId);
    if (!target) return null;
    const order: AppointmentStatus[] = ['Not confirmed', 'Confirmed', 'In chair', 'Done'];
    const curIdx = order.indexOf(target.status);
    const nextStatus = curIdx < order.length - 1 ? order[curIdx + 1] : order[0];
    await this.updateStatus(shopId, apptId, nextStatus);
    return nextStatus;
  }

  /**
   * Update appointment details (time, slot, stylist, notes)
   */
  async updateAppointment(
    shopId: string,
    apptId: string,
    updates: {
      starts_at?: string;
      staff_id?: string | null;
      staff_name?: string;
      service_id?: string | null;
      service_name?: string;
      duration_minutes?: number;
      notes?: string | null;
      status?: AppointmentStatus;
      is_edited?: boolean;
    }
  ): Promise<Appointment | null> {
    const current = (await this.getCachedAppointments(shopId)) || [];
    const index = current.findIndex((a) => a.id === apptId);
    let updatedAppt: Appointment | null = null;
    const nowIso = new Date().toISOString();

    let updatedNotesStr = updates.notes;
    if (index !== -1) {
      let existingNotesObj: any = {};
      try {
        existingNotesObj = current[index].notes ? JSON.parse(current[index].notes!) : {};
      } catch {
        existingNotesObj = { note_text: current[index].notes };
      }
      existingNotesObj = {
        ...existingNotesObj,
        is_edited: true,
        edited_at: nowIso,
      };
      if (updates.notes !== undefined) {
        existingNotesObj.note_text = updates.notes;
      }
      if (updates.staff_name !== undefined) {
        existingNotesObj.staff_name = updates.staff_name;
      }
      updatedNotesStr = JSON.stringify(existingNotesObj);

      current[index] = {
        ...current[index],
        ...updates,
        is_edited: true,
        edited_at: nowIso,
        staff_name: updates.staff_name !== undefined ? updates.staff_name : current[index].staff_name,
        notes: updatedNotesStr,
      };
      updatedAppt = current[index];
    }

    if (isRemoteShop(shopId) && isValidUuid(apptId)) {
      const dbPayload: any = {};
      if (updates.starts_at !== undefined) dbPayload.starts_at = updates.starts_at;
      if (updates.duration_minutes !== undefined) dbPayload.duration_minutes = updates.duration_minutes;
      if (updates.status !== undefined) dbPayload.status = updates.status;
      if (updatedNotesStr !== undefined) dbPayload.notes = updatedNotesStr;
      if (updates.staff_id !== undefined) {
        dbPayload.staff_id = isValidUuid(updates.staff_id) ? updates.staff_id : null;
      }
      if (updates.service_id !== undefined) {
        dbPayload.service_id = isValidUuid(updates.service_id) ? updates.service_id : null;
      }

      if (Object.keys(dbPayload).length > 0) {
        const result = await supabase.from('appointments').update(dbPayload).eq('id', apptId).select('id');
        assertSaved(result, 'the appointment');
        if (!result.data || result.data.length === 0) {
          throw new Error('This appointment was not found on the server, so the changes were not saved.');
        }
      }
    }

    // Only now does the phone's copy change
    if (index !== -1) {
      await this.cacheAppointments(shopId, current);
    }

    return updatedAppt;
  }

  /**
   * Delete appointment with audit trail (who deleted it)
   */
  async deleteAppointment(
    shopId: string,
    apptId: string,
    deletedBy?: { role: 'owner' | 'stylist'; name: string }
  ): Promise<void> {
    const current = (await this.getCachedAppointments(shopId)) || [];
    const target = current.find((a) => a.id === apptId);
    const updated = current.filter((a) => a.id !== apptId);

    const nowIso = new Date().toISOString();
    const resolvedRole = deletedBy?.role || 'owner';
    const resolvedName = deletedBy?.name || (resolvedRole === 'stylist' ? 'Stylist' : 'Owner');

    const deletedRecord: Appointment = target
      ? {
          ...target,
          status: 'Cancelled',
          is_deleted: true,
          deleted_at: nowIso,
          deleted_by_role: resolvedRole,
          deleted_by_name: resolvedName,
        }
      : {
          id: apptId,
          shop_id: shopId,
          customer_id: null,
          customer_name: 'Customer',
          staff_id: null,
          staff_name: 'Stylist',
          service_id: null,
          service_name: 'Service',
          starts_at: nowIso,
          duration_minutes: 30,
          status: 'Cancelled',
          notes: null,
          amount_minor: 0,
          created_at: nowIso,
          is_deleted: true,
          deleted_at: nowIso,
          deleted_by_role: resolvedRole,
          deleted_by_name: resolvedName,
        };

    if (isRemoteShop(shopId) && isValidUuid(apptId)) {
      let notesPayload: any = {};
      try {
        notesPayload = target?.notes ? JSON.parse(target.notes) : {};
      } catch {
        notesPayload = { note_text: target?.notes };
      }
      const updatedNotes = JSON.stringify({
        ...notesPayload,
        is_deleted: true,
        deleted_at: nowIso,
        deleted_by_role: resolvedRole,
        deleted_by_name: resolvedName,
      });

      const result = await supabase
        .from('appointments')
        .update({ status: 'Cancelled', notes: updatedNotes })
        .eq('id', apptId);
      assertSaved(result, 'the cancellation');
    }

    // Only now does the phone's copy change
    await this.cacheAppointments(shopId, updated);
    await this.saveDeletedAppointment(shopId, deletedRecord);
  }

  async getDeletedAppointments(shopId: string): Promise<Appointment[]> {
    try {
      const raw = await AsyncStorage.getItem(`@salon_os_deleted_appts_${shopId}`);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return [];
  }

  async saveDeletedAppointment(shopId: string, appt: Appointment): Promise<void> {
    try {
      const existing = (await this.getDeletedAppointments(shopId)) || [];
      const updated = [appt, ...existing.filter((a) => a.id !== appt.id)];
      await AsyncStorage.setItem(`@salon_os_deleted_appts_${shopId}`, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }



  private async cacheAppointments(shopId: string, appts: Appointment[]): Promise<void> {
    await AsyncStorage.setItem(`${STORAGE_KEY_APPTS}_${shopId}`, JSON.stringify(appts));
  }

  async getCachedAppointments(shopId: string): Promise<Appointment[] | null> {
    try {
      const data = await AsyncStorage.getItem(`${STORAGE_KEY_APPTS}_${shopId}`);
      if (data) return JSON.parse(data);
    } catch {
      // ignore
    }
    return null;
  }
}

export const appointmentRepository = new AppointmentRepository();
