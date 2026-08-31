export const PIVNIK_RUNTIME_COMMIT = 'f49c69dbdd50711b15d907e3096fca1125a639d6'
export const PIVNIK_WHEEL_TICKET_COUNT = 500_000
export const PIVNIK_WHEEL_COOLDOWN_MINUTES = 24 * 60

export const PIVNIK_LEGACY_WHEEL_PRIZES = Object.freeze([
  { code:'bonus-5', title:'5 бонусов', tickets:200_000, rewardType:'bonus', rewardValue:{amount:5}, inventoryLimit:null, enabled:true, sortOrder:0 },
  { code:'bonus-10', title:'10 бонусов', tickets:100_000, rewardType:'bonus', rewardValue:{amount:10}, inventoryLimit:null, enabled:true, sortOrder:1 },
  { code:'bonus-20', title:'20 бонусов', tickets:100_000, rewardType:'bonus', rewardValue:{amount:20}, inventoryLimit:null, enabled:true, sortOrder:2 },
  { code:'bonus-50', title:'50 бонусов', tickets:50_000, rewardType:'bonus', rewardValue:{amount:50}, inventoryLimit:null, enabled:true, sortOrder:3 },
  { code:'bonus-100', title:'100 бонусов', tickets:25_000, rewardType:'bonus', rewardValue:{amount:100}, inventoryLimit:null, enabled:true, sortOrder:4 },
  { code:'beer-glass', title:'Бокал пива', tickets:24_999, rewardType:'beer_ml', rewardValue:{amount:500}, inventoryLimit:null, enabled:true, sortOrder:5 },
  { code:'annual-beer', title:'Годовой запас пива', tickets:1, rewardType:'item', rewardValue:{code:'annual-beer',annualSupply:true}, inventoryLimit:null, enabled:true, sortOrder:6 },
].map((prize)=>Object.freeze({
  ...prize,
  probability:(prize.tickets / PIVNIK_WHEEL_TICKET_COUNT * 100).toFixed(prize.tickets === 1 ? 4 : prize.tickets === 24_999 ? 4 : 0),
})))

export interface PivnikLegacyAchievementDefinition {
  code:string
  title:string
  description:string
  rarity:'common'|'rare'|'epic'|'legendary'
  metric:string
  target:number
  unit:'count'|'rub'|'liter'|'bonus'|'special'
  rewardBonus:number
  rewardBeerMl:number
  recurring:string|null
  special:boolean
}

const countable = [
  {code:'first-purchase',title:'Первый тост',description:'Совершите первую покупку в «Пивнике».',rarity:'common',metric:'purchaseCount',target:1,unit:'count',rewardBonus:10},
  {code:'single-check-1000',title:'Тысяча за раз',description:'Оплатите один чек на сумму от 1 000 ₽.',rarity:'common',metric:'maxCheckCents',target:100_000,unit:'rub',rewardBonus:10},
  {code:'three-purchases',title:'Третий звонок',description:'Совершите 3 покупки.',rarity:'common',metric:'purchaseCount',target:3,unit:'count',rewardBonus:10},
  {code:'three-paid-liters',title:'Пенная тройка',description:'Оплатите суммарно 3 литра разливного пива.',rarity:'common',metric:'paidBeerMl',target:3_000,unit:'liter',rewardBonus:10},
  {code:'first-redemption',title:'Бонус в деле',description:'Впервые используйте бонусы при покупке.',rarity:'common',metric:'redemptionCount',target:1,unit:'count',rewardBonus:10},
  {code:'first-shop-purchase',title:'Из запасов Пивника',description:'Купите первый товар в бонусном магазине.',rarity:'common',metric:'shopPurchaseCount',target:1,unit:'count',rewardBonus:10},
  {code:'ten-purchases',title:'Свой человек',description:'Совершите 10 покупок.',rarity:'rare',metric:'purchaseCount',target:10,unit:'count',rewardBonus:20},
  {code:'single-check-3000',title:'Щедрый стол',description:'Оплатите один чек на сумму от 3 000 ₽.',rarity:'rare',metric:'maxCheckCents',target:300_000,unit:'rub',rewardBonus:20},
  {code:'total-spend-10000',title:'Золотой десяток',description:'Потратьте суммарно 10 000 ₽.',rarity:'rare',metric:'totalSpendCents',target:1_000_000,unit:'rub',rewardBonus:20},
  {code:'fifteen-paid-liters',title:'Пивная миля',description:'Оплатите суммарно 15 литров разливного пива.',rarity:'rare',metric:'paidBeerMl',target:15_000,unit:'liter',rewardBonus:20},
  {code:'five-visit-days',title:'Пять вечеров',description:'Совершайте покупки в 5 разных дней.',rarity:'rare',metric:'purchaseDays',target:5,unit:'count',rewardBonus:20},
  {code:'spend-500-bonus',title:'Охотник за бонусами',description:'Используйте суммарно 500 бонусов.',rarity:'rare',metric:'bonusSpent',target:500,unit:'bonus',rewardBonus:20},
  {code:'monthly-top-spender',title:'Король месяца',description:'Займите 1-е место по фактически оплаченным покупкам за завершившийся месяц.',rarity:'epic',metric:'previousMonthWinner',target:1,unit:'count',rewardBonus:0,rewardBeerMl:500,recurring:'monthly'},
  {code:'fifty-purchases',title:'Хранитель стойки',description:'Совершите 50 покупок.',rarity:'epic',metric:'purchaseCount',target:50,unit:'count',rewardBonus:30},
  {code:'single-check-7000',title:'Большой пир',description:'Оплатите один чек на сумму от 7 000 ₽.',rarity:'epic',metric:'maxCheckCents',target:700_000,unit:'rub',rewardBonus:30},
  {code:'total-spend-50000',title:'Печать завсегдатая',description:'Потратьте суммарно 50 000 ₽.',rarity:'epic',metric:'totalSpendCents',target:5_000_000,unit:'rub',rewardBonus:30},
  {code:'fifty-paid-liters',title:'Мастер пенной школы',description:'Оплатите суммарно 50 литров разливного пива.',rarity:'epic',metric:'paidBeerMl',target:50_000,unit:'liter',rewardBonus:30},
  {code:'twenty-visit-days',title:'Летописец Пивника',description:'Совершайте покупки в 20 разных дней.',rarity:'epic',metric:'purchaseDays',target:20,unit:'count',rewardBonus:30},
] as const

const special = [
  {code:'beta-tester',title:'Тестировщик',description:'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».',rarity:'legendary',metric:'specialGrant',target:1,unit:'special',rewardBonus:150},
  {code:'creator',title:'Создатель',description:'Единственное в своём роде. Выдано создателю приложения «Пивник».',rarity:'legendary',metric:'ownerIdentity',target:1,unit:'special',rewardBonus:0},
  {code:'raise-shields',title:'Поднять щиты',description:'Особая легендарная награда трём лучшим тестировщикам «Пивника».',rarity:'legendary',metric:'specialGrant',target:1,unit:'special',rewardBonus:750},
] as const

export const PIVNIK_LEGACY_ACHIEVEMENTS:readonly PivnikLegacyAchievementDefinition[] = Object.freeze([
  ...countable.map((item)=>Object.freeze({rewardBeerMl:0,recurring:null,special:false,...item})),
  ...special.map((item)=>Object.freeze({rewardBeerMl:0,recurring:null,special:true,...item})),
])

export function legacyAchievementCondition(def:PivnikLegacyAchievementDefinition):{conditionType:string;thresholdValue:number}{
  if(def.metric==='purchaseCount')return {conditionType:'purchase_count',thresholdValue:def.target}
  if(def.metric==='maxCheckCents')return {conditionType:'single_check',thresholdValue:def.target/100}
  if(def.metric==='totalSpendCents')return {conditionType:'lifetime_spend',thresholdValue:def.target/100}
  if(def.metric==='shopPurchaseCount')return {conditionType:'shop_purchase',thresholdValue:def.target}
  return {conditionType:'manual',thresholdValue:def.unit==='liter'?def.target/1000:def.target}
}
