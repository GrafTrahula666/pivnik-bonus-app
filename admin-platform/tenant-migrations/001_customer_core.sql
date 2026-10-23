-- Dedicated EMPTY CRM database only. Explicit onboarding command, never startup.
-- Uses the existing customer/auth/wallet contract; no PIVNIK data is copied.
-- The caller must hold the bootstrap advisory lock in the same transaction.
DO $$
BEGIN
  IF current_setting('spaceverse.empty_database_bootstrap', TRUE) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Explicit empty database bootstrap required';
  END IF;
END $$;

CREATE TABLE public.users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  session_version BIGINT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  merged_into_user_id BIGINT REFERENCES public.users(id)
);
CREATE TABLE public.user_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  UNIQUE(provider,provider_user_id),
  UNIQUE(user_id,provider)
);
CREATE TABLE public.wallets (
  user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.transactions (
  id BIGSERIAL PRIMARY KEY,
  request_key TEXT UNIQUE,
  client_id BIGINT NOT NULL REFERENCES public.users(id),
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
);
