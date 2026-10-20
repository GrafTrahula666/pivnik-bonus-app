import {test,expect} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

test('no available database stays pending, preserves the draft and never claims connection',async({page},testInfo)=>{
  const name=testInfo.project.name==='mobile'?'CRM 4':'CRM 1'
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const button=page.getByRole('button',{name:'Подготовить привязку',exact:true})
  await expect(button).toBeEnabled();await button.click()
  const status=page.getByLabel('Статус подготовки базы',{exact:true})
  await expect(status).toContainText('Ожидаем свободную выделенную базу')
  await expect(status).toContainText('Не запущено · не опубликовано')
  await expect(page.getByRole('button',{name:'Сначала подготовьте привязку',exact:true})).toBeDisabled()
  await page.reload()
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  await expect(page.getByLabel('Статус подготовки базы',{exact:true})).toContainText('Ожидаем свободную выделенную базу')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
