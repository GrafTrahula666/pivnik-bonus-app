-- Disposable fixture schema only; never production startup.
CREATE TABLE users(id BIGINT PRIMARY KEY,telegram_id BIGINT,username TEXT,first_name TEXT,role TEXT DEFAULT 'client',
      unlimited_bonus BOOLEAN DEFAULT FALSE,qr_token TEXT,qr_short_code TEXT,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
    CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT NOT NULL,updated_at TIMESTAMPTZ);
    CREATE TABLE transactions(id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,client_id BIGINT REFERENCES users(id),staff_id BIGINT,
      mode TEXT,status TEXT,check_amount_cents BIGINT DEFAULT 0,discount_cents BIGINT DEFAULT 0,
      bonus_spent BIGINT DEFAULT 0,bonus_earned BIGINT DEFAULT 0,cash_paid_cents BIGINT DEFAULT 0,balance_after BIGINT,reason TEXT,
      is_suspicious BOOLEAN DEFAULT FALSE,beer_ml INTEGER DEFAULT 0,beer_gift_earned_ml INTEGER DEFAULT 0,
      completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO users(id,first_name,qr_short_code) VALUES(1,'Guest','PVK-AAAA-2222'),(2,'Other','PVK-BBBB-3333'),(3,'Owner',NULL);
    INSERT INTO wallets(user_id,balance) VALUES(1,1000),(2,500);
