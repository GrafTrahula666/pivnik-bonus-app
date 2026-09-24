import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'app.js');
const indexPath = path.join(root, 'index.html');
const stylesPath = path.join(root, 'styles.css');
let app = fs.readFileSync(appPath, 'utf8');
let html = fs.readFileSync(indexPath, 'utf8');
let css = fs.readFileSync(stylesPath, 'utf8');
let changed = false;

if (!app.includes('function updateRetentionCampaignDraft()')) {
  const anchor = 'async function refreshRetentionAudiencePreview() {';
  if (!app.includes(anchor)) throw new Error('Retention draft UI app anchor not found; run retention preview materializer first');
  const helper = `function updateRetentionCampaignDraft() {\n  const root = $('#retentionCampaignDraft');\n  if (!root) return;\n  const segment = $('#userStatusFilter')?.value || '';\n  if (!['at_risk', 'sleeping'].includes(segment)) { root.hidden = true; return; }\n  root.hidden = false;\n  const channel = $('#retentionDraftChannel')?.value || 'auto';\n  const message = $('#retentionDraftMessage')?.value || '';\n  const count = message.length;\n  const counter = $('#retentionDraftCounter');\n  if (counter) counter.textContent = count + '/500';\n  const summary = $('#retentionDraftSummary');\n  if (summary) {\n    const label = segment === 'at_risk' ? 'В зоне риска' : 'Спящие';\n    const channelLabel = channel === 'telegram' ? 'Telegram' : channel === 'vk' ? 'VK' : 'Автовыбор канала';\n    summary.textContent = 'Черновик: ' + label + ' · ' + channelLabel + ' · отправка отключена';\n  }\n}\n\n`;
  app = app.replace(anchor, helper + anchor);
  const previewRender = "    refreshRetentionAudiencePreview();";
  if (!app.includes(previewRender)) throw new Error('Retention draft UI refresh anchor not found');
  app = app.replace(previewRender, `${previewRender}\n    updateRetentionCampaignDraft();`);
  changed = true;
}

if (!html.includes('id="retentionCampaignDraft"')) {
  const anchor = '<div id="retentionAudiencePreview" class="retention-audience-preview" hidden aria-live="polite"></div>';
  if (!html.includes(anchor)) throw new Error('Retention draft UI HTML anchor not found; run retention preview materializer first');
  const draft = `${anchor}\n        <section id="retentionCampaignDraft" class="retention-campaign-draft" hidden aria-label="Черновик кампании">\n          <div class="retention-draft-head"><b>Черновик кампании</b><span>без отправки</span></div>\n          <label>Канал<select id="retentionDraftChannel" onchange="updateRetentionCampaignDraft()"><option value="auto">Автовыбор</option><option value="telegram">Telegram</option><option value="vk">VK</option></select></label>\n          <label>Сообщение<textarea id="retentionDraftMessage" maxlength="500" rows="3" placeholder="Текст будущей кампании" oninput="updateRetentionCampaignDraft()"></textarea></label>\n          <div class="retention-draft-foot"><span id="retentionDraftSummary">Отправка отключена</span><span id="retentionDraftCounter">0/500</span></div>\n        </section>`;
  html = html.replace(anchor, draft);
  changed = true;
}

if (!css.includes('/* ADMIN_RETENTION_DRAFT_UI */')) {
  css += `\n/* ADMIN_RETENTION_DRAFT_UI */\n.retention-campaign-draft{grid-column:1/-1;padding:14px;border:1px solid rgba(171,137,73,.18);border-radius:14px;background:rgba(255,255,255,.025);display:grid;gap:10px}.retention-campaign-draft[hidden]{display:none}.retention-draft-head,.retention-draft-foot{display:flex;justify-content:space-between;gap:12px;align-items:center}.retention-draft-head span,.retention-draft-foot{color:var(--muted);font-size:11px}.retention-campaign-draft label{display:grid;gap:5px;color:var(--muted);font-size:11px}.retention-campaign-draft select,.retention-campaign-draft textarea{width:100%;box-sizing:border-box}.retention-campaign-draft textarea{resize:vertical;min-height:72px}\n`;
  changed = true;
}

if (changed) {
  fs.writeFileSync(appPath, app);
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(stylesPath, css);
  console.log('Admin retention draft UI materialized');
} else console.log('Admin retention draft UI already materialized');
