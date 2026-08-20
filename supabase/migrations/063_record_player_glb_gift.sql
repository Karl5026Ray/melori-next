insert into public.gifts (
  id, slug, name, tier, asset_url, duration_ms, price_coins, active, sort_order
) values
  ('a3f1c6de-2b8a-4e3f-9c7d-5f6a1b2c3d4e', 'vinyl_music_box', 'Vinyl Music Box', 'epic', '/gifts/record_player.glb', 6000, 400, true, 14)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  tier = excluded.tier,
  asset_url = excluded.asset_url,
  duration_ms = excluded.duration_ms,
  price_coins = excluded.price_coins,
  active = excluded.active,
  sort_order = excluded.sort_order;
