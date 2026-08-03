import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function patchFile(fileName, replacements) {
  const filePath = path.join(__dirname, fileName);
  let content = await fs.readFile(filePath, 'utf8');
  let changed = false;

  for (const { from, to, label } of replacements) {
    if (content.includes(to)) continue;
    if (!content.includes(from)) {
      throw new Error(`Не найден фрагмент для исправления: ${label}`);
    }
    content = content.replace(from, to);
    changed = true;
  }

  if (changed) await fs.writeFile(filePath, content, 'utf8');
}

await patchFile('app.js', [
  {
    label: 'версия клиента',
    from: "const APP_VERSION = '17.0-luxury-vip-space';",
    to: "const APP_VERSION = '17.1-source-truth';"
  },
  {
    label: 'автоматическое открытие достижений при загрузке',
    from: "  renderAchievementCatalog();\n  window.setTimeout(maybeShowAchievementCelebration, 120);\n  return state.achievements;",
    to: "  renderAchievementCatalog();\n  return state.achievements;"
  },
  {
    label: 'автоматическое открытие достижений после операции',
    from: "      state.profile = data.client;\n      renderProfile();\n      window.setTimeout(maybeShowAchievementCelebration, 120);\n    }",
    to: "      state.profile = data.client;\n      renderProfile();\n    }"
  },
  {
    label: 'явное получение достижений',
    from: "document.addEventListener('click', blockUnacceptedAction, true);\n\n$('#openAchievementsButton')?.addEventListener('click', () => openAchievements());",
    to: "document.addEventListener('click', blockUnacceptedAction, true);\n\nfunction openAchievementHub() {\n  if ((state.profile?.unannouncedAchievements || []).length) {\n    maybeShowAchievementCelebration();\n    return;\n  }\n  openAchievements();\n}\n\n$('#openAchievementsButton')?.addEventListener('click', openAchievementHub);"
  },
  {
    label: 'кнопка достижений в профиле',
    from: "$('#openProfileAchievements')?.addEventListener('click', () => openAchievements());",
    to: "$('#openProfileAchievements')?.addEventListener('click', openAchievementHub);"
  }
]);

await patchFile('index.html', [
  {
    label: 'версия клиентского файла',
    from: '<script defer src="app.js?v=17.0-luxury-vip-space"></script>',
    to: '<script defer src="app.js?v=17.1-source-truth"></script>'
  },
  {
    label: 'название подарочного литра',
    from: '<h2>15-й литр — в подарок</h2>',
    to: '<h2>Каждый 15-й литр — бесплатно</h2>'
  },
  {
    label: 'условия подарочного литра',
    from: '<p>Оплатите 14 литров разливного — следующий литр бесплатный.</p>',
    to: '<p>Оплатите 14 литров разливного пива — следующий 1 литр бесплатно.</p>'
  },
  {
    label: 'подпись общей статистики литров',
    from: '<small>выпито в Пивнике</small>',
    to: '<small>учтено разливного</small>'
  },
  {
    label: 'заголовок статистики литров',
    from: '<article><span>Выпито за всё время</span><strong><i id="statsTotalLiters">0</i> л</strong></article>',
    to: '<article><span>Учтено разливного за всё время</span><strong><i id="statsTotalLiters">0</i> л</strong></article>'
  },
  {
    label: 'пояснение статистики литров',
    from: '<p class="help-intro">Литры считаются за всё время, а Лига — только по фактически оплаченным покупкам текущего месяца.</p>',
    to: '<p class="help-intro">Учитывается зафиксированный сотрудником объём разливного пива за всё время. Лига считается только по фактически оплаченным покупкам текущего месяца.</p>'
  }
]);

await import('./universal-server.js');
