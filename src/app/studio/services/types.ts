export interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  deposit_cents: number;
  deposit_percent: number | null;
  is_active: boolean;
  sort_order: number;
  contract_url: string | null;
  hasContract: boolean;
  created_at: string;
  updated_at: string;
}
