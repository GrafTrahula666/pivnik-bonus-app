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

if (!app.includes('async function refreshRetentionAudiencePreview()')) {
  const anchor = 'async function loadAdminUsersDirectory(page = 1) {';
  if (!app.includes(anchor)) throw new Error('Retention preview UI app anchor not found');
  const helper = `let retentionPreviewRequestSeq = 0;\n\nasync function refreshRetentionAudiencePreview() {\n  const root = $('#retentionAudiencePreview');\n  if (!root) return;\n  const segment = $('#userStatusFilter')?.value || '';\n  const requestSeq = ++retentionPreviewRequestSeq;\n  if (!['at_risk', 'sleeping'].includes(segment)) {\n    root.hidden = true;\n    root.innerHTML = '';\n    return;\n  }\n  root.hidden = false;\n  root.innerHTML = '<span class="retention-preview-loading">Считаем доступную аудиторию…</span>';\n  try {\n    const preview = await api(\`/api/admin/retention/audience-preview?segment=\${encodeURIComponent(segment)}\`);\n    if (requestSeq !== retentionPreviewRequestSeq || ($('#userStatusFilter')?.value || '') !== segment) return;\n    const channels = preview?.channels || {};\n    root.innerHTML = \`<div class="retention-preview-title"><b>Аудитория для возврата</b><span>только агрегированные данные</span></div><div class="retention-preview-grid"><div><strong>\${fmt(preview.total || 0)}</strong><span>в сегменте</span></div><div><strong>\${fmt(preview.consented || 0)}</strong><span>с согласием</span></div><div><strong>\${fmt(preview.withoutConsent || 0)}</strong><span>без согласия</span></div><div><strong>\${fmt(channels.telegram || 0)}</strong><span>Telegram</span></div><div><strong>\${fmt(channels.vk || 0)}</strong><span>VK</span></div><div><strong>\${fmt(channels.none || 0)}</strong><span>без канала</span></div></div><small class="retention-preview-note">Предпросмотр не отправляет сообщения и не раскрывает список получателей.</small>\`;\n  } catch (error) {\n    if (requestSeq !== retentionPreviewRequestSeq) return;\n    root.innerHTML = \`<span class="retention-preview-error">Не удалось посчитать аудиторию: \${escapeHtml(error.message || 'ошибка')}</span>\`;\n  }\n}\n\n`;
  app = app.replace(anchor, helper + anchor);

  const renderAnchor = "    renderAdminUsersDirectoryMeta();\n  } catch (error) {";
  if (!app.includes(renderAnchor)) throw new Error('Retention preview UI render anchor not found');
  app = app.replace(renderAnchor, "    renderAdminUsersDirectoryMeta();\n    refreshRetentionAudiencePreview();\n  } catch (error) {");
  changed = true;
}

if (!html.includes('id="retentionAudiencePreview"')) {
  const anchor = '          <option value="no_visits">Без визитов · более 30 дней</option>\n        </select>';
  if (!html.includes(anchor)) throw new Error('Retention preview UI lifecycle anchor not found; run Customer 360 UI materializer first');
  html = html.replace(anchor, `${anchor}\n        <div id="retentionAudiencePreview" class="retention-audience-preview" hidden aria-live="polite"></div>`);
  changed = true;
}

if (!css.includes('/* ADMIN_RETENTION_PREVIEW_UI */')) {
  css += `\n/* ADMIN_RETENTION_PREVIEW_UI */\n.retention-audience-preview{grid-column:1/-1;padding:14px;border:1px solid rgba(171,137,73,.22);border-radius:14px;background:rgba(255,255,255,.035)}.retention-preview-title{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:10px}.retention-preview-title span,.retention-preview-note,.retention-preview-loading{color:var(--muted);font-size:11px}.retention-preview-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.retention-preview-grid div{padding:9px;border-radius:10px;background:rgba(255,255,255,.035)}.retention-preview-grid strong,.retention-preview-grid span{display:block}.retention-preview-grid strong{font-size:16px}.retention-preview-grid span{color:var(--muted);font-size:10px;margin-top:2px}.retention-preview-note{display:block;margin-top:10px}.retention-preview-error{color:#e9a5a5;font-size:12px}@media(max-width:720px){.retention-preview-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.retention-preview-title{align-items:flex-start;flex-direction:column;gap:3px}}\n`;
  changed = true;
}

if (changed) {
  fs.writeFileSync(appPath, app);
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(stylesPath, css);
  console.log('Admin retention preview UI materialized');
} else console.log('Admin retention preview UI already materialized');
