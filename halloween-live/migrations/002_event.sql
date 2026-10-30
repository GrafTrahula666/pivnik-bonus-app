-- MANUAL. Add the live event only; never alter the existing closing time.
INSERT INTO halloween_live.events(id,state) VALUES (
  'pivnik-halloween-2026',
  '{"mode":"live","guests":[],"draws":[],"main":null,"excludeWinners":true,"registrationOpen":true,"stage":{"id":"waiting","status":"waiting"},"prizes":[{"id":"beer1","title":"1 литр пива","kind":"beer","amount":1000},{"id":"beer05","title":"0,5 литра пива","kind":"beer","amount":500},{"id":"bonus100","title":"100 бонусов","kind":"bonus","amount":100},{"id":"bonus250","title":"250 бонусов","kind":"bonus","amount":250}]}'::jsonb
) ON CONFLICT(id) DO NOTHING;
