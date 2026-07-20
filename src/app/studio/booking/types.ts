export interface AvailabilityRule {
  id?: string;
  weekday: number; // 0=Sun..6=Sat
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

export interface PhotographerSettings {
  timezone: string;
  min_notice_hours: number;
  max_advance_days: number;
  slot_interval_minutes: number;
  buffer_minutes: number;
  updated_at: string | null;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

export interface BookingItem {
  id: string;
  serviceId: string | null;
  serviceName: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  notes: string | null;
  depositCents: number;
  depositPaid: boolean;
  hasGoogleEvent: boolean;
  createdAt: string;
}
