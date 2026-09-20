import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`SPACEVERSE daily series: ${label} anchor missing`);
  return source.replace(from, to);
}

await patchFile('server.js', (source) => {
  source = replaceOnce(
    source,
    "      )\n      SELECT user_metrics.*, tx_metrics.*\n      FROM user_metrics\n      CROSS JOIN tx_metrics",
    "      ),\n      daily_series AS (\n        SELECT\n          days.day::date AS day,\n          COALESCE(SUM(t.check_amount_cents), 0)::bigint AS check_cents,\n          COUNT(t.id)::int AS completed_ops\n        FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)\n        LEFT JOIN transactions t\n          ON t.status='completed'\n         AND t.created_at >= days.day\n         AND t.created_at < days.day + INTERVAL '1 day'\n        GROUP BY days.day\n        ORDER BY days.day\n      )\n      SELECT user_metrics.*, tx_metrics.*,\n        (SELECT COALESCE(json_agg(json_build_object(\n          'date', day,\n          'check_cents', check_cents,\n          'completed_ops', completed_ops\n        ) ORDER BY day), '[]'::json) FROM daily_series) AS daily_series_30d\n      FROM user_metrics\n      CROSS JOIN tx_metrics",
    'daily series SQL'
  );
  source = replaceOnce(
    source,
    "        previousAverageCheck30d: summaryResult.rows[0].previous_completed_ops_30d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].previous_check_cents_30d || 0) / summaryResult.rows[0].previous_completed_ops_30d))\n          : 0,\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    "        previousAverageCheck30d: summaryResult.rows[0].previous_completed_ops_30d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].previous_check_cents_30d || 0) / summaryResult.rows[0].previous_completed_ops_30d))\n          : 0,\n        dailySeries30d: (summaryResult.rows[0].daily_series_30d || []).map((item) => ({\n          date: item.date,\n          check: rubles(item.check_cents),\n          completedOperations: Number(item.completed_ops || 0)\n        })),\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    'daily series response'
  );
  return source;
});

await patchFile('index.html', (source) => replaceOnce(
  source,
  "        <div class=\"card admin-channel-card admin-write-only\" id=\"adminBroadcastCard\">",
  "        <div class=\"card admin-trend-card\" id=\"adminTrendCard\">\n          <div class=\"card-head\"><div><span class=\"muted\">Динамика</span><h3>Выручка за 30 дней</h3><p>Завершённые продажи по дням. Высота столбца — выручка.</p></div><span class=\"pill\">30 ДНЕЙ</span></div>\n          <div class=\"admin-trend-chart\" id=\"adminTrendChart\" aria-label=\"График выручки за 30 дней\"></div>\n          <div class=\"admin-trend-legend\"><span id=\"adminTrendTotal\">0 ₽</span><small id=\"adminTrendSales\">0 продаж</small></div>\n        </div>\n\n        <div class=\"card admin-channel-card admin-write-only\" id=\"adminBroadcastCard\">",
  'trend card'
));

await patchFile('app.js', (source) => replaceOnce(
  source,
  "  $('#metricTodayDelta').textContent = [todayComparison, trend7d, trend30d].filter(Boolean).join(' · ');",
  "  $('#metricTodayDelta').textContent = [todayComparison, trend7d, trend30d].filter(Boolean).join(' · ');\n  const dailySeries = Array.isArray(summary.dailySeries30d) ? summary.dailySeries30d.slice(-30) : [];\n  const trendChart = $('#adminTrendChart');\n  if (trendChart) {\n    const maxCheck = Math.max(1, ...dailySeries.map((item) => Number(item.check || 0)));\n    trendChart.innerHTML = dailySeries.map((item) => {\n      const check = Math.max(0, Number(item.check || 0));\n      const completed = Math.max(0, Number(item.completedOperations || 0));\n      const height = check > 0 ? Math.max(6, Math.round((check / maxCheck) * 100)) : 2;\n      const label = new Date(item.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });\n      return `<div class=\"admin-trend-day\" title=\"${escapeHtml(label)} · ${fmt(check)} ₽ · ${completed} продаж\"><i style=\"height:${height}%\"></i><small>${escapeHtml(label)}</small></div>`;\n    }).join('') || '<div class=\"empty-state\">Пока нет данных за 30 дней</div>';\n    const totalCheck = dailySeries.reduce((sum, item) => sum + Math.max(0, Number(item.check || 0)), 0);\n    const totalSales = dailySeries.reduce((sum, item) => sum + Math.max(0, Number(item.completedOperations || 0)), 0);\n    $('#adminTrendTotal').textContent = `${fmt(totalCheck)} ₽`;\n    $('#adminTrendSales').textContent = `${totalSales} заверш. продаж`;\n  }",
  'trend renderer'
));

await patchFile('black-frosted-surfaces.css', (source) => {
  const marker = '/* SPACEVERSE_ADMIN_DAILY_TREND */';
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}\n\n${marker}\n.admin-trend-card{overflow:hidden}.admin-trend-chart{height:180px;display:flex;align-items:flex-end;gap:3px;padding:18px 2px 2px}.admin-trend-day{height:100%;min-width:0;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px}.admin-trend-day i{display:block;width:100%;min-height:2px;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,rgba(136,112,255,.95),rgba(92,74,210,.35));box-shadow:0 0 14px rgba(110,90,255,.18)}.admin-trend-day small{font-size:8px;opacity:.55;white-space:nowrap}.admin-trend-day small{display:none}.admin-trend-day:nth-child(5n+1) small,.admin-trend-day:last-child small{display:block}.admin-trend-legend{display:flex;justify-content:space-between;align-items:baseline;margin-top:10px}.admin-trend-legend span{font-size:20px;font-weight:800}.admin-trend-legend small{opacity:.65}@media(max-width:520px){.admin-trend-chart{height:145px;gap:2px}.admin-trend-day:nth-child(5n+1) small{display:none}.admin-trend-day:nth-child(7n+1) small,.admin-trend-day:last-child small{display:block}}\n`;
});

console.log('SPACEVERSE admin daily series applied.');
