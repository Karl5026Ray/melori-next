-- 058_gifting_wallet_and_catalog.sql
-- Checked-in copy of production migration 20260810182601.
-- Coin movement is restricted to SECURITY DEFINER functions invoked by
-- authenticated server routes; clients receive catalog and balance data only.

create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_coins integer not null default 0 check (balance_coins >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_coins integer not null,
  reason text not null check (
    reason in ('coin_purchase', 'gift_send', 'refund', 'admin_adjust')
  ),
  reference_id text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_id_idx
  on public.wallet_transactions (user_id, created_at desc);
create unique index if not exists wallet_transactions_purchase_idempotency_idx
  on public.wallet_transactions (reference_id, reason)
  where reason = 'coin_purchase';

create table if not exists public.coin_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coin_amount integer not null check (coin_amount > 0),
  price_usd_cents integer not null check (price_usd_cents > 0),
  bonus_label text,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tier text not null check (tier in ('spark', 'glow', 'epic')),
  asset_url text not null,
  duration_ms integer not null check (duration_ms > 0),
  price_coins integer not null check (price_coins > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_sends (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid references auth.users(id) on delete set null,
  gift_id uuid not null references public.gifts(id),
  coins_spent integer not null,
  created_at timestamptz not null default now()
);

create index if not exists gift_sends_space_id_idx
  on public.gift_sends (space_id, created_at desc);

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.coin_packs enable row level security;
alter table public.gifts enable row level security;
alter table public.gift_sends enable row level security;

drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets
  for select using ((select auth.uid()) = user_id);

drop policy if exists "wallet_transactions_select_own"
  on public.wallet_transactions;
create policy "wallet_transactions_select_own" on public.wallet_transactions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "coin_packs_select_active" on public.coin_packs;
create policy "coin_packs_select_active" on public.coin_packs
  for select using (active = true);

drop policy if exists "gifts_select_active" on public.gifts;
create policy "gifts_select_active" on public.gifts
  for select using (active = true);

drop policy if exists "gift_sends_select_all" on public.gift_sends;
create policy "gift_sends_select_all" on public.gift_sends
  for select using (true);

create or replace function public.spend_coins_on_gift(
  p_user_id uuid,
  p_gift_id uuid,
  p_space_id uuid,
  p_target_id uuid default null
) returns table(new_balance integer, gift_send_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price integer;
  v_active boolean;
  v_balance integer;
  v_send_id uuid;
begin
  select price_coins, active into v_price, v_active
    from public.gifts where id = p_gift_id for update;

  if v_price is null then
    raise exception 'gift_not_found';
  end if;
  if not v_active then
    raise exception 'gift_inactive';
  end if;

  insert into public.wallets (user_id, balance_coins)
    values (p_user_id, 0)
    on conflict (user_id) do nothing;

  select balance_coins into v_balance
    from public.wallets where user_id = p_user_id for update;

  if v_balance < v_price then
    raise exception 'insufficient_balance';
  end if;

  update public.wallets
    set balance_coins = balance_coins - v_price, updated_at = now()
    where user_id = p_user_id
    returning balance_coins into v_balance;

  insert into public.wallet_transactions (
    user_id, delta_coins, reason, reference_id
  ) values (p_user_id, -v_price, 'gift_send', p_gift_id::text);

  insert into public.gift_sends (
    space_id, sender_id, target_id, gift_id, coins_spent
  ) values (p_space_id, p_user_id, p_target_id, p_gift_id, v_price)
    returning id into v_send_id;

  return query select v_balance, v_send_id;
end;
$$;

create or replace function public.credit_wallet(
  p_user_id uuid,
  p_coins integer,
  p_reference_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_already boolean;
begin
  select exists(
    select 1 from public.wallet_transactions
    where reference_id = p_reference_id and reason = 'coin_purchase'
  ) into v_already;

  if v_already then
    select balance_coins into v_balance
      from public.wallets where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.wallets (user_id, balance_coins)
    values (p_user_id, p_coins)
    on conflict (user_id) do update
      set balance_coins = wallets.balance_coins + excluded.balance_coins,
          updated_at = now()
    returning balance_coins into v_balance;

  insert into public.wallet_transactions (
    user_id, delta_coins, reason, reference_id
  ) values (p_user_id, p_coins, 'coin_purchase', p_reference_id);

  return v_balance;
end;
$$;

revoke all on function public.spend_coins_on_gift(
  uuid, uuid, uuid, uuid
) from public;
revoke all on function public.credit_wallet(
  uuid, integer, text
) from public;
grant execute on function public.spend_coins_on_gift(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.credit_wallet(
  uuid, integer, text
) to service_role;
grant select on public.wallets, public.wallet_transactions,
  public.coin_packs, public.gifts, public.gift_sends to authenticated;

insert into public.coin_packs (
  id, name, coin_amount, price_usd_cents, bonus_label, active, sort_order
) values
  ('d632c67e-4c6d-4251-867e-cc9ef7a46524', 'Fan Pack', 500, 499, null, true, 1),
  ('deb7f1cd-3e32-4daa-a8ac-b42c454e726b', 'Supporter Pack', 1100, 999, '+10% bonus', true, 2),
  ('be08f08e-3007-4826-bab4-c01f80e7322c', 'Superfan Pack', 2400, 1999, '+20% bonus', true, 3),
  ('d5a8ae3d-ab6c-4afd-9ef3-69c257b64074', 'VIP Pack', 6000, 4999, '+20% bonus', true, 4),
  ('fd153f46-baf8-48e8-9148-7b7414e946a8', 'Legend Pack', 13000, 9999, '+30% bonus', true, 5)
on conflict (id) do update set
  name = excluded.name,
  coin_amount = excluded.coin_amount,
  price_usd_cents = excluded.price_usd_cents,
  bonus_label = excluded.bonus_label,
  active = excluded.active,
  sort_order = excluded.sort_order;

insert into public.gifts (
  id, slug, name, tier, asset_url, duration_ms, price_coins, active, sort_order
) values
  ('1ce14328-89e9-447f-881e-64539c074b5c', 'trumpet', 'Golden Horn', 'spark', '/gifts/trumpet_packed.mp4', 5000, 25, true, 1),
  ('925882e0-354b-483d-9143-a4cca10cc9aa', 'snaredrum', 'Snare Hit', 'spark', '/gifts/snaredrum_packed.mp4', 5000, 25, true, 2),
  ('baff2e2b-9c52-4768-a3c8-47d2b21eba82', 'sax_creating', 'Sax Spark', 'glow', '/gifts/sax_creating_packed.mp4', 10000, 75, true, 3),
  ('891e6237-6b04-4c1c-a107-b25f43dd8389', 'sax_playing', 'Sax Serenade', 'glow', '/gifts/sax_playing_packed.mp4', 10000, 75, true, 4),
  ('e016f867-3d39-4ce2-b47b-43c90c04dd6b', 'sax_blooming', 'Sax Bloom', 'glow', '/gifts/sax_blooming_packed.mp4', 10000, 75, true, 5),
  ('18b67955-95d9-4142-bcd6-2731b4727d09', 'maraca_sparkle', 'Maraca Shake', 'glow', '/gifts/maraca_sparkle_packed.mp4', 10000, 75, true, 6),
  ('5e2b21ee-54d4-4cc7-a055-ffb945ecfc99', 'maraca_cartoon', 'Maraca Pop', 'glow', '/gifts/maraca_cartoon_packed.mp4', 10000, 75, true, 7),
  ('7fe7ed05-0abc-444b-b166-14e311a03fe3', 'drumline_epic', 'Drumline Surge', 'epic', '/gifts/epic/drumline_epic.mp4', 10000, 400, true, 8),
  ('abe9be6d-d3bb-4cbf-b56d-3cf55f1b6f25', 'guitarpick_epic', 'Melori Pick', 'epic', '/gifts/epic/guitarpick_epic.mp4', 10000, 400, true, 9),
  ('5da47486-c1af-40ad-8322-aaa054dc5977', 'helicopter_cabin_epic', 'Helicopter Entrance', 'epic', '/gifts/epic/helicopter_cabin_epic.mp4', 8000, 400, true, 10),
  ('154c0a5b-3d8e-483f-946a-40785471acd7', 'helicopter_flyover_epic', 'Helicopter Flyover', 'epic', '/gifts/epic/helicopter_flyover_epic.mp4', 10000, 400, true, 11),
  ('c86f915b-d171-43c6-803f-4178659ed6c7', 'jet_fireworks_epic', 'Jet & Fireworks', 'epic', '/gifts/epic/jet_fireworks_epic.mp4', 10000, 400, true, 12),
  ('95e9e187-e93e-496d-845b-bacfaf70d8ee', 'stage_lasers_epic', 'Laser Stage', 'epic', '/gifts/epic/stage_lasers_epic.mp4', 10000, 400, true, 13)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  tier = excluded.tier,
  asset_url = excluded.asset_url,
  duration_ms = excluded.duration_ms,
  price_coins = excluded.price_coins,
  active = excluded.active,
  sort_order = excluded.sort_order;

-- Existing checkout fulfillment writes `paid`; include it as a valid state.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'paid', 'completed', 'refunded'));
