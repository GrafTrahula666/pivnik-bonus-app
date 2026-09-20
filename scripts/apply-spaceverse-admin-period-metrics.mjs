import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`SPACEVERSE period metrics: ${label} anchor missing`);
  return source.replace(from, to);
}

await patchFile('server.js', (source) => {
  source = replaceOnce(
    source,
    "          (COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE))::int AS today_ops,",
    "          (COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE))::int AS today_ops,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at::date = CURRENT_DATE))::int AS today_completed_ops,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at::date = CURRENT_DATE - 1))::int AS yesterday_completed_ops,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '6 days'))::int AS completed_ops_7d,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '13 days' AND created_at < CURRENT_DATE - INTERVAL '6 days'))::int AS previous_completed_ops_7d,\n          COALESCE(SUM(check_amount_cents) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '6 days'), 0)::bigint AS check_cents_7d,\n          COALESCE(SUM(check_amount_cents) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '13 days' AND created_at < CURRENT_DATE - INTERVAL '6 days'), 0)::bigint AS previous_check_cents_7d,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '29 days'))::int AS completed_ops_30d,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '59 days' AND created_at < CURRENT_DATE - INTERVAL '29 days'))::int AS previous_completed_ops_30d,\n          COALESCE(SUM(check_amount_cents) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '29 days'), 0)::bigint AS check_cents_30d,\n          COALESCE(SUM(check_amount_cents) FILTER (WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL '59 days' AND created_at < CURRENT_DATE - INTERVAL '29 days'), 0)::bigint AS previous_check_cents_30d,",
    'transaction period counts'
  );
  source = replaceOnce(
    source,
    "        todayOperations: summaryResult.rows[0].today_ops,\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    "        todayOperations: summaryResult.rows[0].today_ops,\n        todayCompletedOperations: summaryResult.rows[0].today_completed_ops,\n        yesterdayCompletedOperations: summaryResult.rows[0].yesterday_completed_ops,\n        todayAverageCheck: summaryResult.rows[0].today_completed_ops > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].today_check_cents || 0) / summaryResult.rows[0].today_completed_ops))\n          : 0,\n        yesterdayAverageCheck: summaryResult.rows[0].yesterday_completed_ops > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].yesterday_check_cents || 0) / summaryResult.rows[0].yesterday_completed_ops))\n          : 0,\n        completedOperations7d: summaryResult.rows[0].completed_ops_7d,\n        previousCompletedOperations7d: summaryResult.rows[0].previous_completed_ops_7d,\n        check7d: rubles(summaryResult.rows[0].check_cents_7d),\n        previousCheck7d: rubles(summaryResult.rows[0].previous_check_cents_7d),\n        averageCheck7d: summaryResult.rows[0].completed_ops_7d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].check_cents_7d || 0) / summaryResult.rows[0].completed_ops_7d))\n          : 0,\n        previousAverageCheck7d: summaryResult.rows[0].previous_completed_ops_7d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].previous_check_cents_7d || 0) / summaryResult.rows[0].previous_completed_ops_7d))\n          : 0,\n        completedOperations30d: summaryResult.rows[0].completed_ops_30d,\n        previousCompletedOperations30d: summaryResult.rows[0].previous_completed_ops_30d,\n        check30d: rubles(summaryResult.rows[0].check_cents_30d),\n        previousCheck30d: rubles(summaryResult.rows[0].previous_check_cents_30d),\n        averageCheck30d: summaryResult.rows[0].completed_ops_30d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].check_cents_30d || 0) / summaryResult.rows[0].completed_ops_30d))\n          : 0,\n        previousAverageCheck30d: summaryResult.rows[0].previous_completed_ops_30d > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].previous_check_cents_30d || 0) / summaryResult.rows[0].previous_completed_ops_30d))\n          : 0,\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    'summary response period metrics'
  );
  return source;
});

await patchFile('app.js', (source) => {
  const todayLegacy = "  $('#metricTodayOps').textContent = `${summary.todayOperations || 0} операций`;";
  const todayPatched = "  const completedToday = Number(summary.todayCompletedOperations || 0);\n  const averageToday = Number(summary.todayAverageCheck || 0);\n  $('#metricTodayOps').textContent = completedToday > 0\n    ? `${completedToday} заверш. · ср. чек ${fmt(averageToday)} ₽`\n    : 'нет завершённых операций';";
  const comparisonLegacy = "  $('#metricTodayDelta').textContent = deltaLabel;";
  const comparisonPatched = "  const completedYesterday = Number(summary.yesterdayCompletedOperations || 0);\n  const averageYesterday = Number(summary.yesterdayAverageCheck || 0);\n  const salesDelta = completedYesterday > 0 ? ((completedToday - completedYesterday) / completedYesterday) * 100 : null;\n  const averageCheckDelta = averageYesterday > 0 ? ((averageToday - averageYesterday) / averageYesterday) * 100 : null;\n  const deltaParts = [];\n  if (yesterdayCheck > 0) deltaParts.push(`выручка ${deltaLabel}`);\n  if (salesDelta !== null) deltaParts.push(`продажи ${salesDelta >= 0 ? '+' : ''}${salesDelta.toFixed(1)}%`);\n  if (averageCheckDelta !== null) deltaParts.push(`ср. чек ${averageCheckDelta >= 0 ? '+' : ''}${averageCheckDelta.toFixed(1)}%`);\n  const periodTrend = (label, check, previousCheck, completed, previousCompleted, average, previousAverage) => {\n    const parts = [];\n    if (previousCheck > 0) parts.push(`выручка ${((check - previousCheck) / previousCheck * 100) >= 0 ? '+' : ''}${((check - previousCheck) / previousCheck * 100).toFixed(1)}%`);\n    if (previousCompleted > 0) parts.push(`продажи ${((completed - previousCompleted) / previousCompleted * 100) >= 0 ? '+' : ''}${((completed - previousCompleted) / previousCompleted * 100).toFixed(1)}%`);\n    if (previousAverage > 0) parts.push(`ср. чек ${((average - previousAverage) / previousAverage * 100) >= 0 ? '+' : ''}${((average - previousAverage) / previousAverage * 100).toFixed(1)}%`);\n    return parts.length ? `${label}: ${parts.join(' · ')}` : null;\n  };\n  const trend7d = periodTrend('7д', Number(summary.check7d || 0), Number(summary.previousCheck7d || 0), Number(summary.completedOperations7d || 0), Number(summary.previousCompletedOperations7d || 0), Number(summary.averageCheck7d || 0), Number(summary.previousAverageCheck7d || 0));\n  const trend30d = periodTrend('30д', Number(summary.check30d || 0), Number(summary.previousCheck30d || 0), Number(summary.completedOperations30d || 0), Number(summary.previousCompletedOperations30d || 0), Number(summary.averageCheck30d || 0), Number(summary.previousAverageCheck30d || 0));\n  const todayComparison = deltaParts.length ? `${deltaParts.join(' · ')} ко вчера` : 'нет базы сравнения';\n  $('#metricTodayDelta').textContent = [todayComparison, trend7d, trend30d].filter(Boolean).join(' · ');";

  if (!source.includes(todayPatched)) {
    source = replaceOnce(source, todayLegacy, todayPatched, 'today KPI UI');
  }
  if (!source.includes(comparisonPatched)) {
    source = replaceOnce(source, comparisonLegacy, comparisonPatched, 'period comparison UI');
  }
  return source;
});

console.log('SPACEVERSE admin period metrics applied.');
