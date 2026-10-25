/** Pure text-only arrival parser. It never accesses provider data or changes stock. */
export type BeerIntakeRow = {
  line: number
  name: string
  liters: number
  kegCount: number | null
  litersPerKeg: number | null
}
export type BeerIntakeError = { line: number; message: string }
export type BeerIntakeResult = { rows: BeerIntakeRow[]; errors: BeerIntakeError[] }

const DECIMAL = '\\d+(?:[.,]\\d{1,3})?'
const LITERS = '(?:л\\.?|литр(?:а|ов)?)'
const KEGS = new RegExp('^(.+?)\\s*(?:[,;:—-]\\s*)?(?:привезли\\s+|приход\\s+)?\\+?\\s*(' + DECIMAL + ')\\s*кег(?:а|и|у|ов)?\\s*(?:по\\s*)?(' + DECIMAL + ')\\s*' + LITERS + '\\s*$', 'iu')
const VOLUME = new RegExp('^(.+?)\\s*(?:[,;:—-]\\s*)?(?:привезли\\s+|приход\\s+)?\\+?\\s*(' + DECIMAL + ')\\s*' + LITERS + '\\s*$', 'iu')
const valid = (value: number) => Number.isFinite(value) && value > 0 && value <= 10000
const decimal = (value: string) => Number(value.replace(',', '.'))
const normalizedName = (name: string) => name.trim().toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ')

export function parseBeerIntake(input: string): BeerIntakeResult {
  if (input.length > 3000) return { rows: [], errors: [{line: 0, message: 'Слишком длинный текст, максимум 3000 символов.'}] }
  const lines = input.split(/\r?\n/u).map((text, index) => ({line: index + 1, text: text.trim()})).filter(item => item.text)
  if (lines.length > 30) return {rows: [], errors: [{line: 0, message: 'Не более 30 позиций в одном поступлении.'}]}
  const rows: BeerIntakeRow[] = []
  const errors: BeerIntakeError[] = []
  const seen = new Set<string>()
  for (const { line, text } of lines) {
    if (/(?:^|[\s,;:])[-−]\s*\d+(?:[.,]\d+)?\s*(?:кег|л|литр)/iu.test(text)) {
      errors.push({line, message: 'Отрицательные значения не являются приходом.'})
      continue
    }
    const match = KEGS.exec(text)
    const volume = match ? null : VOLUME.exec(text)
    if (!match && !volume) {
      errors.push({line, message: 'Укажите количество в литрах или число кег и объём каждой, например: Пилснер +2 кеги по 30 л.'})
      continue
    }
    const parts = match || volume!
    const name = parts[1]!.replace(/[,;:—-]+\s*$/u, '').trim().replace(/\s+/gu, ' ')
    const kegCount = match ? decimal(parts[2]!) : null
    const litersPerKeg = match ? decimal(parts[3]!) : null
    const liters = Number((match ? kegCount! * litersPerKeg! : decimal(parts[2]!)).toFixed(3))
    if (!name || name.length > 120 || /[<>]/u.test(name) || !valid(liters) || (kegCount !== null && (!valid(kegCount) || !valid(litersPerKeg!)))) {
      errors.push({line, message: 'Проверьте название и объём. Допустимо от 0,001 до 10 000 литров.'})
      continue
    }
    const key = normalizedName(name)
    if (seen.has(key)) {
      errors.push({line, message: 'Повторяющееся название: ' + name + '. Объедините количество в одну строку.'})
      continue
    }
    seen.add(key)
    rows.push({line, name, liters, kegCount, litersPerKeg})
  }
  return {rows, errors}
}
