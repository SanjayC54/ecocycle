-- ============================================================
-- E C O R E C Y C L E   F U L L   S C H E M A   (FINAL)
-- Includes:
--  * recycling_submissions (with auto_delete_at, updated_at)
--  * recycling_submission_images (multi-image)
--  * recycling_settings (default retention)
--  * retention + image RPCs
--  * fallback single + multi create RPC
--  * retention update RPCs
--  * NO RLS (eliminates row-level security errors)
--  * Idempotent (safe to re-run)
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- ------------------------------------------------------------
-- Main table (create if not exists)
-- ------------------------------------------------------------
create table if not exists public.recycling_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile text not null,
  email text,
  address text not null,
  product_details text not null,
  image_path text not null,          -- legacy primary image (first image)
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  auto_delete_at timestamptz,        -- optional retention timestamp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Add missing columns if needed (idempotent safety)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='recycling_submissions' and column_name='auto_delete_at'
  ) then
    alter table public.recycling_submissions add column auto_delete_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name='recycling_submissions' and column_name='updated_at'
  ) then
    alter table public.recycling_submissions add column updated_at timestamptz not null default now();
  end if;
end$$;

-- ------------------------------------------------------------
-- Updated_at trigger
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_updated_at on public.recycling_submissions;
create trigger trg_touch_updated_at
before update on public.recycling_submissions
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Images table (one-to-many)
-- ------------------------------------------------------------
create table if not exists public.recycling_submission_images (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.recycling_submissions(id) on delete cascade,
  image_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_rsub_images_submission on public.recycling_submission_images (submission_id);
create index if not exists idx_rsub_images_position on public.recycling_submission_images (submission_id, position);

-- ------------------------------------------------------------
-- Settings (retention)
-- ------------------------------------------------------------
create table if not exists public.recycling_settings (
  id int primary key default 1,
  default_retention_days int not null default 90,
  updated_at timestamptz not null default now()
);

insert into public.recycling_settings (id, default_retention_days)
values (1,90)
on conflict (id) do nothing;

create or replace function public.touch_settings()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_settings on public.recycling_settings;
create trigger trg_touch_settings
before update on public.recycling_settings
for each row execute function public.touch_settings();

-- ------------------------------------------------------------
-- Retention RPCs
-- ------------------------------------------------------------
create or replace function public.rpc_set_default_retention(_days int)
returns int
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.recycling_settings
  set default_retention_days = greatest(1,_days)
  where id=1;
  return (select default_retention_days from public.recycling_settings where id=1);
end;
$$;
grant execute on function public.rpc_set_default_retention(int) to anon, authenticated;

create or replace function public.rpc_set_submission_retention(_id uuid, _days int)
returns timestamptz
language plpgsql
security definer
set search_path=public
as $$
declare ts timestamptz;
begin
  update public.recycling_submissions
  set auto_delete_at = now() + make_interval(days => greatest(1,_days))
  where id=_id
  returning auto_delete_at into ts;
  return ts;
end;
$$;
grant execute on function public.rpc_set_submission_retention(uuid,int) to anon, authenticated;

-- ------------------------------------------------------------
-- Fallback SINGLE image create RPC (legacy)
-- ------------------------------------------------------------
create or replace function public.rpc_create_recycling_submission(
  _name text,
  _mobile text,
  _email text,
  _address text,
  _product_details text,
  _image_path text,
  _apply_default_retention boolean default false
) returns uuid
language plpgsql security definer
set search_path=public
as $$
declare new_id uuid;
        rdays int;
begin
  if _apply_default_retention then
    select default_retention_days into rdays from public.recycling_settings where id=1;
    insert into public.recycling_submissions
      (name,mobile,email,address,product_details,image_path,auto_delete_at)
    values (_name,_mobile,_email,_address,_product_details,_image_path,
            now() + make_interval(days => rdays))
    returning id into new_id;
  else
    insert into public.recycling_submissions
      (name,mobile,email,address,product_details,image_path)
    values (_name,_mobile,_email,_address,_product_details,_image_path)
    returning id into new_id;
  end if;
  return new_id;
end;
$$;
grant execute on function public.rpc_create_recycling_submission(text,text,text,text,text,text,boolean) to anon, authenticated;

-- ------------------------------------------------------------
-- MULTI image create RPC
-- ------------------------------------------------------------
create or replace function public.rpc_create_recycling_submission_multi(
  _name text,
  _mobile text,
  _email text,
  _address text,
  _product_details text,
  _image_paths text[],              -- MUST contain at least one
  _apply_default_retention boolean default false
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare new_id uuid;
        rdays int;
        p text;
        i int := 0;
        cover_path text;
begin
  if array_length(_image_paths,1) is null or array_length(_image_paths,1) < 1 then
    raise exception 'At least one image path required';
  end if;
  cover_path := _image_paths[1];

  if _apply_default_retention then
    select default_retention_days into rdays from public.recycling_settings where id=1;
    insert into public.recycling_submissions
      (name,mobile,email,address,product_details,image_path,auto_delete_at)
    values (_name,_mobile,_email,_address,_product_details,cover_path,
            now() + make_interval(days => rdays))
    returning id into new_id;
  else
    insert into public.recycling_submissions
      (name,mobile,email,address,product_details,image_path)
    values (_name,_mobile,_email,_address,_product_details,cover_path)
    returning id into new_id;
  end if;

  FOREACH p IN ARRAY _image_paths LOOP
    insert into public.recycling_submission_images (submission_id,image_path,position)
    values (new_id, p, i);
    i := i + 1;
  END LOOP;

  return new_id;
end;
$$;

grant execute on function public.rpc_create_recycling_submission_multi(
  text,text,text,text,text,text[],boolean
) to anon, authenticated;

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
create index if not exists idx_rsub_created on public.recycling_submissions (created_at desc);
create index if not exists idx_rsub_status on public.recycling_submissions (status);
create index if not exists idx_rsub_mobile on public.recycling_submissions (mobile);
create index if not exists idx_rsub_email on public.recycling_submissions (email);
create index if not exists idx_rsub_auto_delete_at on public.recycling_submissions (auto_delete_at);
create index if not exists idx_rsub_trgm_details on public.recycling_submissions using gin (product_details gin_trgm_ops);

-- ------------------------------------------------------------
-- RLS disabled (no row-level security)
-- ------------------------------------------------------------
alter table public.recycling_submissions disable row level security;
alter table public.recycling_submission_images disable row level security;
alter table public.recycling_settings disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.recycling_submissions to anon, authenticated;
grant select, insert, update, delete on public.recycling_submission_images to anon, authenticated;
grant select, update on public.recycling_settings to anon, authenticated;

-- ------------------------------------------------------------
-- Optional manual prune (comment)
-- delete from public.recycling_submissions where auto_delete_at is not null and auto_delete_at < now();
-- ------------------------------------------------------------

-- VERIFICATION (no reserved aliases)
select
  (select relrowsecurity from pg_class where relname='recycling_submissions') as rls_enabled,
  (select count(*) > 0 from information_schema.columns where table_name='recycling_submissions' and column_name='auto_delete_at') as has_auto_delete_at,
  (select count(*) > 0 from information_schema.columns where table_name='recycling_submissions' and column_name='updated_at') as has_updated_at,
  (select count(*) > 0 from information_schema.tables where table_name='recycling_submission_images') as has_images_table;