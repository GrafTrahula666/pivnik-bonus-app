export function cashMoney(cents:string|null|undefined){
  if(cents===null||cents===undefined)return 'Нет данных'
  const value=BigInt(cents),absolute=value<0n?-value:value
  return `${value<0n?'−':''}₽ ${(absolute/100n).toLocaleString('ru-RU')},${String(absolute%100n).padStart(2,'0')}`
}


// Signed BigInt percentages; zero baselines and absent observations are explicit.
export function cashPercentDelta(current:string|number|bigint|null|undefined,baseline:string|number|bigint|null|undefined){
  if(current==null||baseline==null)return null
  const a=BigInt(current),b=BigInt(baseline),diff=a-b
  if(b===0n)return diff===0n?'0%':'Нет базы для %'
  const abs=(v:bigint)=>v<0n?-v:v
  const scaled=abs(diff)*10000n/abs(b),fraction=scaled%100n
  return (diff>0n?'+':diff<0n?'−':'')+(scaled/100n).toLocaleString('ru-RU')+(fraction?','+String(fraction).padStart(2,'0'):'')+'%'
}
