-- 059_cinema_playback_playlist.sql
--
-- Adds an ordered, host-authoritative five-item queue to the existing Cinema
-- playback row. source_url/source_type remain the active-item mirror, so older
-- clients and the established drift-correction player keep working unchanged.

alter table public.room_playback_state
  add column if not exists playlist_items jsonb not null default '[]'::jsonb,
  add column if not exists active_playlist_index smallint not null default 0,
  add column if not exists playlist_revision integer not null default 0;

alter table public.room_playback_state
  drop constraint if exists room_playback_state_playlist_items_array_check;
alter table public.room_playback_state
  add constraint room_playback_state_playlist_items_array_check
  check (
    jsonb_typeof(playlist_items) = 'array'
    and jsonb_array_length(playlist_items) <= 5
  );

alter table public.room_playback_state
  drop constraint if exists room_playback_state_active_playlist_index_check;
alter table public.room_playback_state
  add constraint room_playback_state_active_playlist_index_check
  check (active_playlist_index between 0 and 4);

alter table public.room_playback_state
  drop constraint if exists room_playback_state_playlist_revision_check;
alter table public.room_playback_state
  add constraint room_playback_state_playlist_revision_check
  check (playlist_revision >= 0);

create or replace function public.mutate_cinema_playlist(
  p_space_id uuid,
  p_expected_revision integer,
  p_command jsonb,
  p_actor_id uuid
)
returns public.room_playback_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space public.spaces%rowtype;
  v_state public.room_playback_state%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_action text := coalesce(p_command->>'action', '');
  v_item_id text;
  v_active_id text;
  v_source_url text;
  v_source_type text;
  v_title text;
  v_from integer := -1;
  v_to integer := -1;
  v_index integer;
  v_length integer;
  v_reset_timing boolean := false;
  v_next_playing boolean;
  v_seen_ids text[] := array[]::text[];
begin
  select *
    into v_space
    from public.spaces
   where id = p_space_id
   for update;

  if not found then raise exception 'Room not found' using errcode = 'P0002'; end if;
  if v_space.room_format is distinct from 'cinema' then
    raise exception 'This room is not a Cinema room' using errcode = '22023';
  end if;
  if v_space.status = 'ended' then
    raise exception 'This room has ended' using errcode = '55000';
  end if;
  if v_space.host_id <> p_actor_id then
    raise exception 'Only the host controls the playlist' using errcode = '42501';
  end if;

  insert into public.room_playback_state (space_id, updated_by)
  values (p_space_id, p_actor_id)
  on conflict (space_id) do nothing;

  select *
    into v_state
    from public.room_playback_state
   where space_id = p_space_id
   for update;

  v_items := coalesce(v_state.playlist_items, '[]'::jsonb);

  -- A legacy source becomes a durable queue item only when the host first
  -- edits the queue. Until then the row remains readable by old and new code.
  if jsonb_array_length(v_items) = 0
     and v_state.source_url is not null
     and v_action <> 'legacy_source_set' then
    v_items := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'source_type', v_state.source_type,
      'source_url', v_state.source_url,
      'title', 'Current screening'
    ));
    v_state.active_playlist_index := 0;
  end if;

  if v_action <> 'legacy_source_set'
     and coalesce(p_expected_revision, -1) <> v_state.playlist_revision then
    raise exception 'Playlist changed in another host session'
      using errcode = '40001',
            detail = v_state.playlist_revision::text;
  end if;

  v_length := jsonb_array_length(v_items);
  if v_length > 0 then
    v_state.active_playlist_index :=
      least(greatest(v_state.active_playlist_index, 0), v_length - 1);
    v_active_id := v_items->v_state.active_playlist_index->>'id';
  end if;

  if v_action = 'append' then
    if v_length >= 5 then
      raise exception 'A Cinema playlist can contain at most five items'
        using errcode = '22023';
    end if;
    v_item := p_command->'item';
    if v_item is null then raise exception 'item is required' using errcode = '22023'; end if;
    v_items := v_items || jsonb_build_array(v_item);
    if v_length = 0 then
      v_state.active_playlist_index := 0;
      v_reset_timing := true;
    end if;

  elsif v_action = 'select' then
    v_item_id := p_command->>'item_id';
    for v_index in 0..greatest(v_length - 1, -1) loop
      if v_items->v_index->>'id' = v_item_id then v_to := v_index; exit; end if;
    end loop;
    if v_to < 0 then raise exception 'Playlist item not found' using errcode = 'P0002'; end if;
    if v_to <> v_state.active_playlist_index then v_reset_timing := true; end if;
    v_state.active_playlist_index := v_to;

  elsif v_action = 'move' then
    v_item_id := p_command->>'item_id';
    v_to := coalesce((p_command->>'to_index')::integer, -1);
    if v_to < 0 or v_to >= v_length then
      raise exception 'to_index is outside the playlist' using errcode = '22023';
    end if;
    for v_index in 0..greatest(v_length - 1, -1) loop
      if v_items->v_index->>'id' = v_item_id then v_from := v_index; exit; end if;
    end loop;
    if v_from < 0 then raise exception 'Playlist item not found' using errcode = 'P0002'; end if;
    v_item := v_items->v_from;
    v_items := (
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(v_items) with ordinality
       where ordinality - 1 <> v_from
    );
    v_items := jsonb_insert(v_items, array[v_to::text], v_item, false);
    select ordinality - 1
      into v_state.active_playlist_index
      from jsonb_array_elements(v_items) with ordinality
     where value->>'id' = v_active_id;

  elsif v_action = 'remove' then
    v_item_id := p_command->>'item_id';
    for v_index in 0..greatest(v_length - 1, -1) loop
      if v_items->v_index->>'id' = v_item_id then v_from := v_index; exit; end if;
    end loop;
    if v_from < 0 then raise exception 'Playlist item not found' using errcode = 'P0002'; end if;
    v_items := (
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
        from jsonb_array_elements(v_items) with ordinality
       where ordinality - 1 <> v_from
    );
    if v_item_id = v_active_id then
      v_state.active_playlist_index :=
        least(v_from, greatest(jsonb_array_length(v_items) - 1, 0));
      v_reset_timing := true;
    else
      select ordinality - 1
        into v_state.active_playlist_index
        from jsonb_array_elements(v_items) with ordinality
       where value->>'id' = v_active_id;
    end if;

  elsif v_action = 'advance' then
    -- A duplicate/stale ended event is intentionally a no-op.
    if p_command->>'ended_item_id' is distinct from v_active_id then
      return v_state;
    elsif v_state.active_playlist_index + 1 < v_length then
      v_state.active_playlist_index := v_state.active_playlist_index + 1;
      v_reset_timing := true;
    else
      v_state.is_playing := false;
    end if;

  elsif v_action = 'clear' then
    v_items := '[]'::jsonb;
    v_state.active_playlist_index := 0;
    v_reset_timing := true;

  elsif v_action = 'legacy_source_set' then
    v_item := p_command->'item';
    if v_item is null then
      v_items := '[]'::jsonb;
      v_state.active_playlist_index := 0;
      v_reset_timing := true;
    else
      v_items := '[]'::jsonb;
      v_state.source_url := v_item->>'source_url';
      v_state.source_type := v_item->>'source_type';
      v_state.position_seconds := 0;
      v_state.duration_seconds := null;
      v_state.is_playing := false;
      update public.room_playback_state
         set playlist_items = v_items,
             active_playlist_index = 0,
             playlist_revision = playlist_revision + 1,
             source_url = v_state.source_url,
             source_type = v_state.source_type,
             position_seconds = 0,
             duration_seconds = null,
             is_playing = false,
             updated_by = p_actor_id
       where space_id = p_space_id
       returning * into v_state;
      return v_state;
    end if;
  else
    raise exception 'Unknown playlist action' using errcode = '22023';
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 5 then
    raise exception 'Invalid Cinema playlist' using errcode = '22023';
  end if;

  -- Validate the durable object shape and duplicate IDs inside the lock.
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_item_id := nullif(btrim(v_item->>'id'), '');
    v_source_type := v_item->>'source_type';
    v_source_url := nullif(btrim(v_item->>'source_url'), '');
    v_title := nullif(btrim(coalesce(v_item->>'title', '')), '');
    if v_item_id is null or v_source_url is null
       or v_source_type not in ('url', 'youtube') then
      raise exception 'Invalid playlist item' using errcode = '22023';
    end if;
    if v_item_id = any(v_seen_ids) then
      raise exception 'Playlist item IDs must be unique' using errcode = '22023';
    end if;
    if v_title is not null and length(v_title) > 200 then
      raise exception 'Playlist item title is too long' using errcode = '22023';
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
  end loop;

  v_length := jsonb_array_length(v_items);
  if v_length = 0 then
    v_state.active_playlist_index := 0;
    v_source_url := null;
    v_source_type := 'url';
    v_state.is_playing := false;
  else
    v_state.active_playlist_index :=
      least(greatest(v_state.active_playlist_index, 0), v_length - 1);
    v_item := v_items->v_state.active_playlist_index;
    v_source_url := v_item->>'source_url';
    v_source_type := v_item->>'source_type';
  end if;

  if v_reset_timing then
    v_state.position_seconds := 0;
    v_state.duration_seconds := null;
    -- Advancing an item that just ended should continue the screening.
    v_next_playing := v_action = 'advance' and v_state.is_playing;
    v_state.is_playing := v_next_playing;
  end if;

  update public.room_playback_state
     set playlist_items = v_items,
         active_playlist_index = v_state.active_playlist_index,
         playlist_revision = playlist_revision + 1,
         source_url = v_source_url,
         source_type = v_source_type,
         position_seconds = v_state.position_seconds,
         duration_seconds = v_state.duration_seconds,
         is_playing = v_state.is_playing,
         updated_by = p_actor_id
   where space_id = p_space_id
   returning * into v_state;

  return v_state;
end;
$$;

revoke all on function public.mutate_cinema_playlist(uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.mutate_cinema_playlist(uuid, integer, jsonb, uuid)
  to service_role;

comment on function public.mutate_cinema_playlist(uuid, integer, jsonb, uuid) is
  'Atomically mutates a Cinema room playlist after locking and rechecking the host. Service-role only; callers validate/canonicalize URLs before invoking it.';
