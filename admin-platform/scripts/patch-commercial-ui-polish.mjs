import fs from 'node:fs/promises'

async function patchFile(relativePath, replacements){
  const url=new URL(`../${relativePath}`,import.meta.url)
  let source=await fs.readFile(url,'utf8')
  for(const {from,to,label} of replacements){
    const count=source.split(from).length-1
    if(count!==1)throw new Error(`${relativePath}: expected one ${label}, found ${count}`)
    source=source.replace(from,to)
  }
  await fs.writeFile(url,source)
}

await patchFile('src/phaseC/ProductionDashboard.tsx',[
  {label:'active customers label',from:"['Активных по операциям',m.activeCustomers,'number',p.transactionActiveCustomers]",to:"['Совершали операции',m.activeCustomers,'number',p.transactionActiveCustomers]"},
  {label:'bonus earned label',from:"['Начислено бонусов',m.bonusEarned,'number',p.bonusEarned]",to:"['Начислено по программе',m.bonusEarned,'number',p.bonusEarned]"},
  {label:'bonus redeemed label',from:"['Списано бонусов',m.bonusRedeemed,'number',p.bonusRedeemed]",to:"['Списано клиентами',m.bonusRedeemed,'number',p.bonusRedeemed]"},
  {label:'bonus balance label',from:"['Баланс бонусов',m.outstandingBonusBalance,'number',p.outstandingBonusBalance]",to:"['Бонусы в обращении',m.outstandingBonusBalance,'number',p.outstandingBonusBalance]"},
  {label:'redemption rate label',from:"['Доля списаний',m.redemptionRate,'percent',p.redemptionRate]",to:"['Использование бонусов',m.redemptionRate,'percent',p.redemptionRate]"},
  {label:'dashboard KPI note',from:'    <div className="kpi-grid">{kpis.map(([label,mm,kind,prev])=><LiveKpi key={label} label={label} metric={mm as Metric} kind={kind} previous={prev as number|null|undefined}/>)}</div>\n    <div className="grid-main">',to:'    <div className="kpi-grid">{kpis.map(([label,mm,kind,prev])=><LiveKpi key={label} label={label} metric={mm as Metric} kind={kind} previous={prev as number|null|undefined}/>)}</div>\n    <SourceNote>Ручные персональные подарки не входят в бизнес-KPI обзора. Реальные балансы клиентов при этом сохраняются без изменений.</SourceNote>\n    <div className="grid-main">'},
  {label:'quality title',from:'<b>Честная аналитика</b><span>Показатели отображаются только при наличии достоверных данных.</span>',to:'<b>Качество данных</b><span>Панель показывает только те показатели, которые можно корректно посчитать по текущей истории.</span>'},
])

await patchFile('src/phaseC/ProductionReadPages.tsx',[
  {label:'operation count label',from:'<div><Database/><span>Строк</span><b>{data.rows.length}</b></div>',to:'<div><Database/><span>Операций</span><b>{data.rows.length}</b></div>'},
  {label:'operation credit label',from:'<div><Coins/><span>Начислено</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusEarned||0),0))}</b></div>',to:'<div><Coins/><span>Начислено бонусов</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusEarned||0),0))}</b></div>'},
  {label:'operation debit label',from:'<div><Coins/><span>Списано</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusSpent||0),0))}</b></div>',to:'<div><Coins/><span>Списано бонусов</span><b>{rub.format(data.rows.reduce((s,r)=>s+Number(r.bonusSpent||0),0))}</b></div>'},
  {label:'operation bonus cell',from:'          <td>+{r.bonusEarned||0} / −{r.bonusSpent||0}</td><td>{r.reason||r.reward_code||\'—\'}</td></tr>)}</tbody>',to:'          <td><div className="bonus-flow"><span className="bonus-plus">+{r.bonusEarned||0} Б</span><span className="bonus-minus">−{r.bonusSpent||0} Б</span></div></td><td>{r.reason||r.reward_code||\'—\'}</td></tr>)}</tbody>'},
  {label:'analytics event code',from:'<code>{x.requiredEvent}</code>',to:'<small>Показатель появится автоматически после накопления достаточной истории.</small>'},
  {label:'analytics bonus earned',from:"['Начислено бонусов',data.metrics.bonusEarned,'number']",to:"['Начислено по программе',data.metrics.bonusEarned,'number']"},
  {label:'analytics bonus redeemed',from:"['Списано бонусов',data.metrics.bonusRedeemed,'number']",to:"['Списано клиентами',data.metrics.bonusRedeemed,'number']"},
  {label:'analytics bonus balance',from:"['Баланс бонусов',data.metrics.outstandingBonusBalance,'number']",to:"['Бонусы в обращении',data.metrics.outstandingBonusBalance,'number']"},
  {label:'analytics redemption rate',from:"['Доля списаний',data.metrics.redemptionRate,'percent']",to:"['Использование бонусов',data.metrics.redemptionRate,'percent']"},
])

await patchFile('src/phaseC/ProductionCRM.tsx',[
  {label:'crm search placeholder',from:'placeholder="Имя, ник или ID клиента…"',to:'placeholder="Имя, @ник или ID клиента…"'},
  {label:'crm source pill',from:'<div className="live-source-pill"><span/><Database/>ДАННЫЕ ЗАВЕДЕНИЯ</div>',to:'<div className="live-source-pill"><span/><Database/>АКТУАЛЬНЫЕ ДАННЫЕ</div>'},
  {label:'crm detail summary',from:'          <Detail label="Операций" value={String(client.operationCount)}/><Detail label="Начислено" value={rub.format(client.bonusEarned)}/><Detail label="Списано" value={rub.format(client.bonusRedeemed)}/>\n        </div>\n        <h3 className="section-title">Профили</h3>',to:'          <Detail label="Операций" value={String(client.operationCount)}/><Detail label="Начислено" value={rub.format(client.bonusEarned)}/><Detail label="Списано" value={rub.format(client.bonusRedeemed)}/>\n          <Detail label="Последняя активность" value={dt(client.lastActivityAt)}/><Detail label="Регистрация" value={dt(client.registeredAt)}/><Detail label="Канал" value={client.platform||\'—\'}/>\n        </div>\n        <SourceNote>Баланс показывает фактическое количество бонусов клиента. Персональные подарки сохраняются на счёте, но не искажают бизнес-KPI обзора.</SourceNote>\n        <h3 className="section-title">Каналы и профили</h3>'},
])

await patchFile('src/phaseC/PivnikLegacyManagers.tsx',[
  {label:'legacy imports',from:"import {ErrorCard,LoadingCard,SourceNote,WriteGatePill,useResource} from './common'",to:"import {ErrorCard,LoadingCard,SourceNote,useResource} from './common'\nimport {businessLabel} from './labels'"},
  {label:'wheel header',from:'    <PageHead eyebrow="РАБОЧАЯ КОНФИГУРАЦИЯ" title="Колесо" sub={`${venue.companyName} → ${venue.name}`}\n      actions={<WriteGatePill enabled={false}/>}/>',to:'    <PageHead eyebrow="КОЛЕСО ФОРТУНЫ" title="Колесо" sub={`${venue.companyName} → ${venue.name} · действующие настройки`}\n      actions={<span className="view-only-badge"><ShieldCheck/>Только просмотр</span>}/>'},
  {label:'wheel probability note',from:"<small>{Math.abs(total-100)<1e-9?'Текущая рабочая таблица':'Требуется проверка'}</small>",to:"<small>{Math.abs(total-100)<1e-9?'Вероятности настроены корректно':'Сумма должна быть 100%'}</small>"},
  {label:'wheel source note',from:"        <SourceNote>{legacy\n          ? `Показана фактическая конфигурация текущего runtime ПИВНИКА (${data.runtimeCommit?.slice(0,8)||'production'}). Редактирование намеренно отключено: эта страница пока только читает рабочую механику.`\n          : 'Показана сохранённая конфигурация Admin Platform. Редактирование на controlled pilot отключено.'}</SourceNote>",to:"        <SourceNote>{legacy\n          ? 'Показана действующая механика колеса ПИВНИКА. Панель сейчас только читает настройки: гостевое колесо продолжает работать независимо.'\n          : 'Показана сохранённая конфигурация. На controlled pilot редактирование отключено.'}</SourceNote>"},
  {label:'achievement header',from:'    <PageHead eyebrow="РАБОЧИЙ КАТАЛОГ" title="Достижения" sub={`${venue.companyName} → ${venue.name}`}\n      actions={<WriteGatePill enabled={false}/>}/>',to:'    <PageHead eyebrow="ДОСТИЖЕНИЯ ГОСТЕЙ" title="Достижения" sub={`${venue.companyName} → ${venue.name} · ${data.items.filter(x=>x.enabled).length} активных`}\n      actions={<span className="view-only-badge"><ShieldCheck/>Только просмотр</span>}/>'},
  {label:'achievement source note',from:"      <SourceNote>{legacy\n        ? `Показан текущий production-каталог ПИВНИКА (${data.runtimeCommit?.slice(0,8)||'production'}): автоматические достижения и специальные легендарные награды. Редактирование пока отключено.`\n        : 'Показана сохранённая конфигурация Admin Platform. Редактирование на controlled pilot отключено.'}</SourceNote>",to:"      <SourceNote>{legacy\n        ? 'Показан действующий каталог ПИВНИКА: автоматические достижения и специальные награды. Редактирование на controlled pilot отключено.'\n        : 'Показан сохранённый каталог. Редактирование на controlled pilot отключено.'}</SourceNote>"},
  {label:'achievement rarity',from:"              <span>{item.rarity||'achievement'}</span>",to:"              <span>{businessLabel(item.rarity||'achievement')}</span>"},
])

console.log('Commercial UI polish patches applied successfully.')
