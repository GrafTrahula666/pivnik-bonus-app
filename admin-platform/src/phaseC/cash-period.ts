const stamp=(value:string)=>Date.parse(value+'T00:00:00+03:00')
export function validateCashRange(from:string,to:string,today:string){
  const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(stamp(value))&&new Date(stamp(value)+3*3600000).toISOString().slice(0,10)===value
  if(!valid(from)||!valid(to))return 'Выберите существующие даты.'
  if(from>to)return 'Начало периода должно быть не позднее окончания.'
  if(to>today)return 'Выберите дату не позднее сегодняшней по Москве.'
  if((stamp(to)-stamp(from))/86400000+1>366)return 'Выберите период от 1 до 366 дней.'
  return ''
}
