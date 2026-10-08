const labels:Record<string,string>={
  accrue:'Начисление за покупку',redeem:'Оплата бонусами',adjustment:'Ручное изменение',achievement:'Награда за достижение',wheel:'Приз колеса',shop:'Покупка в магазине',shop_purchase:'Покупка в магазине',
  completed:'Успешно',pending:'В обработке',failed:'Ошибка',cancelled:'Отменено',
  purchase_count:'Количество покупок',single_check:'Сумма одного чека',lifetime_spend:'Общая сумма покупок',wheel_spin:'Прокруты колеса',manual:'Ручная выдача',
  bonus:'Бонусы',beer_ml:'Напиток',item:'Товар',digital_reward:'Цифровой подарок',frame:'Рамка профиля',retry:'Повторная попытка',none:'Без награды',
  digital:'Цифровые товары',merch:'Сувениры',other:'Другое',
  common:'Обычное',uncommon:'Необычное',rare:'Редкое',epic:'Эпическое',legendary:'Легендарное',
  DRAFT:'Черновик',SCHEDULED:'Запланирована',ACTIVE:'Активна',FINISHED:'Завершена',DISABLED:'Отключена',
  'auth.login':'Вход в панель','auth.logout':'Выход из панели','staging.seed':'Подготовка тестового заведения',
  'customer.bonus.credit':'Начисление бонусов','customer.bonus.debit':'Списание бонусов','customer.achievement.grant':'Выдача достижения','customer.entitlement.grant':'Выдача награды','customer.cashback.override':'Индивидуальный кешбэк',
  'loyalty.config.save':'Настройки лояльности','wheel.config.save':'Настройки колеса','achievements.config.save':'Настройки достижений','shop.config.save':'Настройки магазина','promotions.config.save':'Настройки акций','branding.config.save':'Оформление','venue.features.save':'Настройки разделов',
  admin_session:'Сессия администратора',customer_wallet:'Баланс клиента',customer_achievement:'Достижение клиента',customer_entitlement:'Награда клиента',customer_cashback:'Кешбэк клиента',
  loyalty_config:'Программа лояльности',wheel_config:'Колесо призов',achievement_config:'Достижения',shop_config:'Магазин',promotion_config:'Акции',venue_branding:'Оформление',venue_settings:'Настройки заведения',venue:'Заведение',
}

export const businessLabel=(value:string|null|undefined)=>labels[String(value||'')]||String(value||'—')

export function rewardSummary(value:Record<string,unknown>|null|undefined){
  if(!value||!Object.keys(value).length)return 'Без дополнительной награды'
  const parts:string[]=[]
  if(value.bonus!==undefined)parts.push(`${value.bonus} бонусов`)
  if(value.beerMl!==undefined)parts.push(`${value.beerMl} мл напитка`)
  if(value.frame!==undefined)parts.push('Рамка профиля')
  if(value.amount!==undefined)parts.push(String(value.amount))
  if(value.code!==undefined)parts.push('Выбранный товар')
  return parts.length?parts.join(' · '):'Настроенная награда'
}

export function auditValueSummary(value:unknown){
  if(!value)return '—'
  if(typeof value!=='object')return String(value)
  const row=value as Record<string,unknown>
  if(row.balance!==undefined)return `Баланс: ${row.balance}`
  if(row.items&&Array.isArray(row.items))return `${row.items.length} позиций`
  if(row.granted!==undefined)return row.granted?'Выдано':'Не выдано'
  return 'Данные обновлены'
}
