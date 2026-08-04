import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');

const RETENTION_POLICY = 'Данные профиля и идентификаторы VK/Telegram хранятся до удаления аккаунта. Резервные копии, содержащие удалённые данные, автоматически перезаписываются не позднее 90 дней. Сведения о покупках, начислениях, списаниях и иные документы, необходимые для бухгалтерского и налогового учёта, хранятся 5 лет. Согласия, история принятия правил, обращения в поддержку, журналы безопасности и криптографический отпечаток удалённой платформенной идентичности хранятся 3 года после удаления аккаунта или завершения обращения. По истечении применимого срока данные удаляются либо обезличиваются, если законодательство не требует более длительного хранения.';

const originalBlock = `const legalOperatorName = String(process.env.LEGAL_OPERATOR_NAME || '').trim();
const legalOperatorId = String(process.env.LEGAL_OPERATOR_ID || '').trim();
const legalContactEmail = String(process.env.LEGAL_CONTACT_EMAIL || '').trim();
const legalOperatorAddress = String(process.env.LEGAL_OPERATOR_ADDRESS || '').trim();
const legalDataRetentionPolicy = String(process.env.LEGAL_DATA_RETENTION_POLICY || '').trim();`;

const configuredBlock = `const DEFAULT_LEGAL_OPERATOR_NAME = 'Индивидуальный предприниматель Иживильгин Виталий Викторович';
const DEFAULT_LEGAL_OPERATOR_ID = 'ИНН 380415014659';
const DEFAULT_LEGAL_CONTACT_EMAIL = 'origtopg666@gmail.com';
const DEFAULT_LEGAL_OPERATOR_ADDRESS = 'г. Санкт-Петербург, проспект Энгельса, д. 55';
const DEFAULT_LEGAL_DATA_RETENTION_POLICY = ${JSON.stringify(RETENTION_POLICY)};
const legalOperatorName = String(process.env.LEGAL_OPERATOR_NAME || DEFAULT_LEGAL_OPERATOR_NAME).trim();
const legalOperatorId = String(process.env.LEGAL_OPERATOR_ID || DEFAULT_LEGAL_OPERATOR_ID).trim();
const legalContactEmail = String(process.env.LEGAL_CONTACT_EMAIL || DEFAULT_LEGAL_CONTACT_EMAIL).trim();
const legalOperatorAddress = String(process.env.LEGAL_OPERATOR_ADDRESS || DEFAULT_LEGAL_OPERATOR_ADDRESS).trim();
const legalDataRetentionPolicy = String(
  process.env.LEGAL_DATA_RETENTION_POLICY || DEFAULT_LEGAL_DATA_RETENTION_POLICY
).trim();`;

let gateway = await fs.readFile(gatewayPath, 'utf8');
if (!gateway.includes(configuredBlock)) {
  if (!gateway.includes(originalBlock)) {
    throw new Error('Не найден блок юридической конфигурации для заполнения реквизитов.');
  }
  gateway = gateway.replace(originalBlock, configuredBlock);
}

for (const marker of [
  'Индивидуальный предприниматель Иживильгин Виталий Викторович',
  'ИНН 380415014659',
  'origtopg666@gmail.com',
  'г. Санкт-Петербург, проспект Энгельса, д. 55',
  'Резервные копии, содержащие удалённые данные, автоматически перезаписываются не позднее 90 дней',
  'необходимые для бухгалтерского и налогового учёта, хранятся 5 лет',
  'криптографический отпечаток удалённой платформенной идентичности хранятся 3 года'
]) {
  if (!gateway.includes(marker)) {
    throw new Error(`Не применена юридическая конфигурация: ${marker}`);
  }
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Pivnik legal operator configuration applied and verified.');
