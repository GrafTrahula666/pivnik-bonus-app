import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesPath = path.join(root, 'styles.css');
const indexPath = path.join(root, 'index.html');
const marker = '/* V18 · readable premium typography */';
const assetVersion = '18.0-readable-premium-type';

const typographyPatch = `

${marker}
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body,
button,
input,
select,
textarea {
  font-family: var(--font-ui) !important;
  font-synthesis: none;
  font-optical-sizing: auto;
}

body {
  font-size: 15px;
  line-height: 1.45;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.topbar h1,
.balance,
.home-stat-card strong,
.achievement-count strong,
.client-page-title h2,
.league-summary > strong,
.shop-private-monogram,
.shop-private-stock strong,
.shop-category-head h3,
.shop-list-copy b {
  font-family: var(--font-ui) !important;
}

.topbar h1 {
  font-size: 29px;
  font-weight: 820;
  line-height: 1;
  letter-spacing: .015em;
}

.eyebrow {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: .035em;
}

.beta-badge,
.network-badge {
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .045em;
}

.client-name {
  font-size: 19px;
  font-weight: 760;
  line-height: 1.15;
}

.balance {
  font-size: 38px;
  font-weight: 780;
  line-height: .9;
  letter-spacing: -.04em;
}

.balance small {
  margin-top: 7px;
  font-family: var(--font-ui) !important;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.15;
}

#clientBalance.unlimited-balance {
  font-size: 46px;
  font-weight: 760;
}

.status-caption,
.home-card-kicker,
.beer-kicker {
  font-size: 10px;
  font-weight: 760;
  line-height: 1.3;
  letter-spacing: .095em;
}

.status-name {
  font-size: 20px;
  font-weight: 720;
  line-height: 1.15;
}

.cashback-orbit strong {
  font-size: 21px;
  font-weight: 760;
}

.cashback-orbit small {
  font-size: 9px;
  font-weight: 650;
  line-height: 1.15;
}

.max-status-line,
.max-status-line strong {
  font-size: 11px;
  line-height: 1.3;
}

.beer-card-top h2 {
  font-size: 19px;
  font-weight: 730;
  line-height: 1.2;
  letter-spacing: -.015em;
}

.beer-card-top p {
  font-size: 13px;
  line-height: 1.48;
}

.beer-gift-counter small,
.beer-progress-head,
.beer-progress-head b,
.beer-card-foot span,
.beer-card-foot strong {
  font-size: 11px;
  line-height: 1.35;
}

.home-stat-card strong {
  font-size: 27px;
  font-weight: 760;
  line-height: 1;
  letter-spacing: -.025em;
}

.home-stat-card small {
  font-size: 11px;
  line-height: 1.35;
}

.compact-card-head h2 {
  font-size: 17px;
  font-weight: 740;
  line-height: 1.15;
}

.section-link {
  font-size: 12px;
  font-weight: 650;
}

.achievement-count strong {
  font-size: 27px;
  font-weight: 760;
}

.achievement-count span {
  font-size: 10px;
  line-height: 1.2;
}

.home-achievement-card .profile-achievement-medal small {
  max-width: 44px;
  font-size: 9px;
  line-height: 1.15;
}

.home-achievement-card .achievement-inbox-copy b {
  font-size: 11px;
}

.home-shop-card > strong {
  font-size: 12px;
  line-height: 1.35;
}

.shop-cta {
  font-size: 10px;
  font-weight: 760;
}

.home-promo-banner small,
.home-promo-banner em {
  font-size: 10px;
  line-height: 1.3;
}

.home-promo-banner strong {
  font-size: 15px;
  font-weight: 720;
  line-height: 1.25;
}

.client-page-title > .muted {
  font-size: 12px;
}

.client-page-title h2 {
  font-size: 30px;
  font-weight: 780;
  line-height: 1.05;
  letter-spacing: -.03em;
}

.client-page-title p {
  font-size: 13px;
  line-height: 1.5;
}

.league-summary > span,
.league-summary > small {
  font-size: 11px;
}

.league-summary > strong {
  font-size: 35px;
  font-weight: 760;
  letter-spacing: -.035em;
}

.league-summary > b {
  font-size: 12px;
  line-height: 1.4;
}

.profile-identity-card > div > .muted {
  font-size: 12px;
}

.profile-identity-card h2 {
  font-size: 21px;
  font-weight: 760;
  line-height: 1.15;
}

.profile-identity-card small,
.profile-identity-card strong {
  font-size: 11px;
  line-height: 1.3;
}

.history-tabs button {
  min-height: 38px;
  font-size: 12px;
  font-weight: 680;
}

.profile-history-card .op-row b {
  font-size: 15px;
}

.profile-history-card .op-row small {
  font-size: 12px;
  line-height: 1.4;
}

.profile-history-card .op-row > strong {
  font-size: 14px;
}

.profile-shortcuts button {
  min-height: 82px;
}

.profile-shortcuts button > strong {
  overflow: visible;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  text-overflow: clip;
  white-space: normal;
}

.profile-shortcuts button > small {
  font-size: 9px;
}

.profile-menu > button b {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}

.profile-menu > button small {
  font-size: 11px;
  line-height: 1.35;
}

.section-title h2,
.service-access h2 {
  font-size: 19px;
  font-weight: 740;
  line-height: 1.2;
}

.service-access p,
.team-strip small,
.shift-person small {
  font-size: 12px;
  line-height: 1.45;
}

.service-back,
.staff-switch-button {
  font-size: 13px;
  font-weight: 650;
}

.staff-banner > div > .muted,
.admin-head .muted {
  font-size: 13px;
}

.staff-banner h2,
.admin-head h2 {
  font-size: 25px;
  font-weight: 780;
  line-height: 1.1;
}

.shift-badge,
.pill {
  font-size: 11px;
  line-height: 1.25;
}

.step-heading h3,
.card h3 {
  font-size: 18px;
  font-weight: 740;
  line-height: 1.2;
}

.step-heading small,
.card p,
.card label,
.field-caption span,
.field-caption small,
.scan-zone small,
.mode small,
.calc-box span,
.staff-recent-card .card-head p {
  font-size: 12px;
  line-height: 1.45;
}

.mode b {
  font-size: 14px;
  font-weight: 700;
}

.primary,
.secondary,
.operation-button,
.scan-zone,
.manual-code-button,
.text-btn,
.copy-code,
.text-link {
  font-size: 14px;
  line-height: 1.25;
}

.money-input input {
  font-size: 36px;
}

.volume-input input {
  font-size: 26px;
}

.volume-presets button,
.gift-volume {
  font-size: 12px;
}

.op-row b,
.user-row b,
.leaderboard-row b,
.premium-offer b,
.shop-list-copy b {
  font-size: 14px;
  line-height: 1.25;
}

.op-row small,
.user-row small,
.leaderboard-row small,
.premium-offer p,
.shop-list-copy p {
  font-size: 11px;
  line-height: 1.42;
}

.shop-private-stock small,
.shop-private-seal,
.shop-category-head span,
.shop-list-copy small,
.achievement-tile .achievement-state,
.achievement-tile > strong {
  font-size: 10px;
  line-height: 1.25;
}

.shop-private-stock strong {
  font-size: 20px;
  font-weight: 760;
}

.shop-private-stock p,
.shop-trust-row {
  font-size: 11px;
  line-height: 1.45;
}

.shop-category-head h3 {
  font-size: 21px;
  font-weight: 760;
  line-height: 1.15;
}

.achievement-tile b {
  font-size: 14px;
  line-height: 1.2;
}

.achievement-tile p {
  font-size: 11px;
  line-height: 1.42;
}

.bottom-nav button > small,
.bottom-nav .qr-nav-button > small {
  font-size: 10px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: .035em;
}

.modal-sheet h2 {
  font-size: 25px;
  font-weight: 780;
  line-height: 1.1;
}

.modal-sheet p,
.modal-sheet li,
.help-text p,
.consent-sheet p,
.consent-sheet li {
  font-size: 13px;
  line-height: 1.55;
}

@media (max-width: 370px) {
  body { font-size: 14px; }
  .topbar h1 { font-size: 27px; }
  .balance { font-size: 35px; }
  .profile-shortcuts button > strong { font-size: 9px; }
  .bottom-nav button > small,
  .bottom-nav .qr-nav-button > small { font-size: 9px; }
}
`;

let styles = await fs.readFile(stylesPath, 'utf8');
if (!styles.includes(marker)) {
  styles = `${styles.trimEnd()}${typographyPatch}\n`;
  await fs.writeFile(stylesPath, styles, 'utf8');
}

let index = await fs.readFile(indexPath, 'utf8');
const nextIndex = index.replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${assetVersion}`);
if (nextIndex !== index) {
  index = nextIndex;
  await fs.writeFile(indexPath, index, 'utf8');
}

console.log('Readable premium typography applied.');
