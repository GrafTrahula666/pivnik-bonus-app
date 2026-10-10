-- Halloween: the wheel may pay a pumpkin ticket (prize_code 'halloween-ticket') instead of a glass of beer.
-- Re-runnable widening of the allowed prize codes; no rows are touched.
ALTER TABLE wheel_spins DROP CONSTRAINT IF EXISTS wheel_spins_prize_code_check;
ALTER TABLE wheel_spins ADD CONSTRAINT wheel_spins_prize_code_check CHECK (prize_code IN (
  'bonus-5', 'bonus-10', 'bonus-20', 'bonus-50',
  'bonus-100', 'beer-glass', 'annual-beer', 'halloween-ticket'
));
