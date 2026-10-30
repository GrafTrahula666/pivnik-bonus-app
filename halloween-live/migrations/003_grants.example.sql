-- MANUAL example, reviewed against the actual database by its administrator.
-- Create a dedicated LOGIN role pivnik_halloween_live with a unique password,
-- no superuser / createdb / createrole / inherited broad application grants.
-- This file does not create, display or change credentials.
GRANT USAGE ON SCHEMA public,halloween_live TO pivnik_halloween_live;
GRANT SELECT(id,first_name,last_name,photo_url,qr_token,qr_short_code,merged_into_user_id)
  ON users TO pivnik_halloween_live;
GRANT SELECT(user_id,source_user_id,qr_token,qr_short_code) ON qr_aliases TO pivnik_halloween_live;
GRANT SELECT(number,user_id,status) ON halloween_ticket TO pivnik_halloween_live;
GRANT SELECT ON halloween_draw,halloween_draw_snapshot_ticket TO pivnik_halloween_live;
-- Existing closeDraw/drawNight need only these mutations. NO closing-time grant.
GRANT UPDATE(status,snapshot_hash,seed,results,drawn_at) ON halloween_draw TO pivnik_halloween_live;
GRANT INSERT,DELETE ON halloween_draw_snapshot_ticket TO pivnik_halloween_live;
GRANT SELECT,UPDATE ON halloween_live.events TO pivnik_halloween_live;
GRANT SELECT,INSERT ON halloween_live.requests,halloween_live.audit TO pivnik_halloween_live;
GRANT SELECT,INSERT,DELETE ON halloween_live.sessions TO pivnik_halloween_live;
GRANT SELECT,INSERT,UPDATE ON halloween_live.login_attempts TO pivnik_halloween_live;
GRANT USAGE,SELECT ON SEQUENCE halloween_live.audit_id_seq TO pivnik_halloween_live;
-- No wallets, transactions, beer_loyalty, device, CRM, kiosk or ticket write grants.
