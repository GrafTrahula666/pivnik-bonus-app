export function cashMoney(cents:string|null|undefined){
  if(cents===null||cents===undefined)return 'Нет данных'
  const value=BigInt(cents),absolute=value<0n?-value:value
  return `${value<0n?'−':''}₽ ${(absolute/100n).toLocaleString('ru-RU')},${String(absolute%100n).padStart(2,'0')}`
}

