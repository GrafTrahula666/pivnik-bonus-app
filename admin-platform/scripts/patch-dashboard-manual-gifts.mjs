import fs from 'node:fs/promises';

const target = new URL('../server/data.ts', import.meta.url);
let source = await fs.readFile(target, 'utf8');

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one ${label} marker, found ${count}`);
  }
  source = source.replace(from, to);
}

replaceOnce(
  "       (SELECT COALESCE(SUM(bonus_earned),0)::bigint FROM period_tx) AS bonus_earned,",
  `       (SELECT COALESCE(SUM(bonus_earned) FILTER (\n         WHERE NOT (\n           mode = 'adjustment'\n           AND (\n             staff_id IS NOT NULL\n             OR COALESCE(reward_code, '') LIKE 'admin:bonus:%'\n             OR COALESCE(reason, '') ILIKE 'Персональный подарок%'\n           )\n         )\n       ),0)::bigint FROM period_tx) AS bonus_earned,`,
  'period bonus-earned',
);

replaceOnce(
  "       COALESCE(SUM(t.bonus_earned),0)::bigint AS bonus_earned,",
  `       COALESCE(SUM(t.bonus_earned) FILTER (\n         WHERE NOT (\n           t.mode = 'adjustment'\n           AND (\n             t.staff_id IS NOT NULL\n             OR COALESCE(t.reward_code, '') LIKE 'admin:bonus:%'\n             OR COALESCE(t.reason, '') ILIKE 'Персональный подарок%'\n           )\n         )\n       ),0)::bigint AS bonus_earned,`,
  'trend bonus-earned',
);

replaceOnce(
  "      bonusEarned: available(current.bonusEarned, 'transactions.bonus_earned'),",
  "      bonusEarned: available(current.bonusEarned, 'автоматические начисления; ручные подарки исключены'),",
  'bonus-earned source label',
);

replaceOnce(
  "          : available(current.redemptionRate, 'bonus_spent / bonus_earned'),",
  "          : available(current.redemptionRate, 'bonus_spent / автоматические bonus_earned; ручные подарки исключены'),",
  'redemption-rate source label',
);

await fs.writeFile(target, source);
console.log('Patched dashboard bonus KPI: manual personal/admin gifts are excluded from analytics only.');
