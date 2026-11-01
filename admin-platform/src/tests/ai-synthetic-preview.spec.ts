import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { describe,expect,it,vi } from 'vitest'
import { AiSyntheticPreview } from '../phaseC/AiSyntheticPreview'
import { SYNTHETIC_AI_PREVIEW } from '../phaseC/ai-synthetic-preview'

describe('CHAT 14 / 134: honest synthetic preview only',()=>{
  it('has a fixed local fixture, zero external requests and no model',()=>{
    expect(SYNTHETIC_AI_PREVIEW).toMatchObject({
      schemaVersion:1,mode:'synthetic',provider:'none',source:'bundled-static-fixture',
      externalRequests:0,usesRealVenueData:false,generatedByModel:false,
    })
    expect(SYNTHETIC_AI_PREVIEW.examples.map(e=>e.id)).toEqual(['trend','anomaly','recommendation'])
    expect(SYNTHETIC_AI_PREVIEW.examples[1]?.status).toBe('insufficient_data')
    const fixture=JSON.stringify(SYNTHETIC_AI_PREVIEW)
    expect(fixture).not.toMatch(/https?:\/\/|companyId|venueId|customerId|secretKey/i)
  })

  it('clearly labels the page as fictional and never calls fetch while rendering',()=>{
    const fetchSpy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('External requests forbidden'))
    try{
      const html=renderToStaticMarkup(createElement(AiSyntheticPreview))
      expect(html).toContain('СИНТЕТИЧЕСКИЕ ДАННЫЕ')
      expect(html).toContain('Внешние API-запросы:')
      expect(html).toContain('нет AI-модели')
      expect(html).toContain('Недостаточно данных')
      expect(html).toContain('Гипотеза')
      expect(html).toContain('Никаких рекомендаций на основании данных вашего бизнеса')
      expect(html).not.toContain('₽')
      expect(fetchSpy).not.toHaveBeenCalled()
    }finally{fetchSpy.mockRestore()}
  })

  it('mounts the preview exclusively on the existing demo analytics page',async()=>{
    const demo=await readFile(new URL('../phaseC/DemoMode.tsx',import.meta.url),'utf8')
    const app=await readFile(new URL('../App.tsx',import.meta.url),'utf8')
    expect(demo).toContain("page==='analytics'&&<><AnalyticsPage/><AiSyntheticPreview/></>")
    expect(app).not.toContain("import { AiSyntheticPreview }")
    expect(app).toContain("import { DemoMode }")
  })
})
