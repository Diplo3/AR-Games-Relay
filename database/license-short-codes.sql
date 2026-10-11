create table if not exists public.ar_license_requests (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  request_payload jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists ar_license_requests_expires_idx on public.ar_license_requests (expires_at);

create table if not exists public.ar_license_activations (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  token_payload jsonb not null,
  device_id text not null,
  product_code text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_device_id text
);
create index if not exists ar_license_activations_expires_idx on public.ar_license_activations (expires_at);

alter table public.ar_license_requests enable row level security;
alter table public.ar_license_activations enable row level security;

create or replace function public.redeem_ar_games_activation(p_code_hash text, p_device_id text, p_product_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  update public.ar_license_activations
     set redeemed_at = coalesce(redeemed_at, now()),
         redeemed_device_id = coalesce(redeemed_device_id, p_device_id)
   where code_hash = p_code_hash
     and device_id = p_device_id
     and product_code = p_product_code
     and expires_at > now()
     and (redeemed_at is null or redeemed_device_id = p_device_id)
  returning token_payload into result;
  return result;
end;
$$;
revoke all on function public.redeem_ar_games_activation(text,text,text) from public, anon, authenticated;
grant execute on function public.redeem_ar_games_activation(text,text,text) to service_role;
