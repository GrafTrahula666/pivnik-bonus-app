import fs from 'node:fs';
import path from 'node:path';

const appPath = path.join(process.cwd(), 'app.js');
let app = fs.readFileSync(appPath, 'utf8');
let changed = false;

const stateMarker = 'segments: { new: 0, active: 0, at_risk: 0, sleeping: 0, no_visits: 0 }';
const metaMarker = "const segmentLabels = { new: 'Новые', active: 'Активные'";
const responseMarker = 'new: Number(data.segments?.new || 0)';

// The response anchor is intentionally generic because the legacy runtime has several
// directory-shaped state assignments. Never run replacements again once this materializer's
// complete marker set is present, otherwise a second materialization can mutate a different
// assignment and break release idempotency.
if (app.includes(stateMarker) && app.includes(metaMarker) && app.includes(responseMarker)) {
  console.log('Admin CRM segment counters already materialized');
  process.exit(0);
}

const stateAnchor = "  adminUsersDirectory: { page: 1, limit: 25, total: 0, pages: 1, busy: false },";
const stateReplacement = "  adminUsersDirectory: { page: 1, limit: 25, total: 0, pages: 1, busy: false, segments: { new: 0, active: 0, at_risk: 0, sleeping: 0, no_visits: 0 } },";
if (app.includes(stateAnchor)) {
  app = app.replace(stateAnchor, stateReplacement);
  changed = true;
} else if (!app.includes(stateMarker)) {
  throw new Error('CRM segment state anchor not found');
}

const metaAnchor = "  if (meta) meta.textContent = `${fmt(directory.total)} пользователей · по ${directory.limit} на странице`;";
const metaReplacement = `  if (meta) meta.textContent = \`\${fmt(directory.total)} пользователей · по \${directory.limit} на странице\`;
  const segmentLabels = { new: 'Новые', active: 'Активные', at_risk: 'В зоне риска', sleeping: 'Спящие', no_visits: 'Без визитов' };
  const segments = directory.segments || {};
  const statusFilter = $('#userStatusFilter');
  if (statusFilter) {
    Object.entries(segmentLabels).forEach(([value, label]) => {
      const option = [...statusFilter.options].find((item) => item.value === value);
      if (option) option.textContent = \`\${label} · \${fmt(segments[value] || 0)}\`;
    });
  }`;
if (app.includes(metaAnchor)) {
  app = app.replace(metaAnchor, metaReplacement);
  changed = true;
} else if (!app.includes(metaMarker)) {
  throw new Error('CRM segment meta anchor not found');
}

const responseAnchor = `      pages: Number(data.pagination?.pages || 1),
      busy: false
    };`;
const responseReplacement = `      pages: Number(data.pagination?.pages || 1),
      busy: false,
      segments: {
        new: Number(data.segments?.new || 0),
        active: Number(data.segments?.active || 0),
        at_risk: Number(data.segments?.at_risk || 0),
        sleeping: Number(data.segments?.sleeping || 0),
        no_visits: Number(data.segments?.no_visits || 0)
      }
    };`;
if (app.includes(responseAnchor)) {
  app = app.replace(responseAnchor, responseReplacement);
  changed = true;
} else if (!app.includes(responseMarker)) {
  throw new Error('CRM segment response anchor not found');
}

if (changed) {
  fs.writeFileSync(appPath, app);
  console.log('Admin CRM segment counters materialized');
} else {
  console.log('Admin CRM segment counters already materialized');
}
