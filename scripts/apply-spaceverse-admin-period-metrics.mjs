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
    "          (COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE))::int AS today_ops,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at::date = CURRENT_DATE))::int AS today_completed_ops,\n          (COUNT(*) FILTER (WHERE status='completed' AND created_at::date = CURRENT_DATE - 1))::int AS yesterday_completed_ops,",
    'transaction period counts'
  );
  source = replaceOnce(
    source,
    "        todayOperations: summaryResult.rows[0].today_ops,\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    "        todayOperations: summaryResult.rows[0].today_ops,\n        todayCompletedOperations: summaryResult.rows[0].today_completed_ops,\n        yesterdayCompletedOperations: summaryResult.rows[0].yesterday_completed_ops,\n        todayAverageCheck: summaryResult.rows[0].today_completed_ops > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].today_check_cents || 0) / summaryResult.rows[0].today_completed_ops))\n          : 0,\n        yesterdayAverageCheck: summaryResult.rows[0].yesterday_completed_ops > 0\n          ? rubles(Math.round(Number(summaryResult.rows[0].yesterday_check_cents || 0) / summaryResult.rows[0].yesterday_completed_ops))\n          : 0,\n        todayCheck: rubles(summaryResult.rows[0].today_check_cents),",
    'summary response period metrics'
  );
  return source;
});

await patchFile('app.js', (source) => {
  source = replaceOnce(
    source,
    "  $('#metricTodayOps').textContent = `${summary.todayOperations || 0} операций`;",
    "  const completedToday = Number(summary.todayCompletedOperations || 0);\n  const averageToday = Number(summary.todayAverageCheck || 0);\n  $('#metricTodayOps').textContent = completedToday > 0\n    ? `${completedToday} заверш. · ср. чек ${fmt(averageToday)} ₽`\n    : 'нет завершённых операций';",
    'dashboard today KPI copy'
  );

  source = replaceOnce(
    source,
    "  $('#metricTodayDelta').textContent = yesterdayCheck > 0 ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% ко вчера` : 'нет базы сравнения';",
    "  const completedYesterday = Number(summary.yesterdayCompletedOperations || 0);\n  const averageYesterday = Number(summary.yesterdayAverageCheck || 0);\n  const salesDelta = completedYesterday > 0 ? ((completedToday - completedYesterday) / completedYesterday) * 100 : null;\n  const averageCheckDelta = averageYesterday > 0 ? ((averageToday - averageYesterday) / averageYesterday) * 100 : null;\n  const deltaParts = [];\n  if (yesterdayCheck > 0) deltaParts.push(`выручка ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);\n  if (salesDelta !== null) deltaParts.push(`продажи ${salesDelta >= 0 ? '+' : ''}${salesDelta.toFixed(1)}%`);\n  if (averageCheckDelta !== null) deltaParts.push(`ср. чек ${averageCheckDelta >= 0 ? '+' : ''}${averageCheckDelta.toFixed(1)}%`);\n  $('#metricTodayDelta').textContent = deltaParts.length ? `${deltaParts.join(' · ')} ко вчера` : 'нет базы сравнения';",
    'dashboard period comparison copy'
  );
  return source;
});

console.log('SPACEVERSE admin period metrics applied.');
