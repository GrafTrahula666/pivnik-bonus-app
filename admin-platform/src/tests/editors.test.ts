import { describe, expect, it } from 'vitest'
import {
  validateLevels, wheelProbabilityTotal, type LoyaltyLevel, type WheelPrize,
} from '../domain'

describe('critical editor validation', () => {
  it('calculates enabled wheel probability total', () => {
    const prizes: WheelPrize[] = [
      { id: '1', title: 'A', probability: 40, rewardType: 'bonus', value: 1, inventory: null, enabled: true },
      { id: '2', title: 'B', probability: 60, rewardType: 'bonus', value: 1, inventory: null, enabled: true },
      { id: '3', title: 'Off', probability: 20, rewardType: 'bonus', value: 1, inventory: null, enabled: false },
    ]
    expect(wheelProbabilityTotal(prizes)).toBe(100)
  })
  it('rejects non-increasing loyalty thresholds', () => {
    const levels: LoyaltyLevel[] = [
      { id: '1', name: 'A', threshold: 1000, cashback: 5, enabled: true },
      { id: '2', name: 'B', threshold: 900, cashback: 7, enabled: true },
    ]
    expect(validateLevels(levels)).toContain('Пороги уровней должны возрастать')
  })
  it('rejects invalid cashback', () => {
    const levels: LoyaltyLevel[] = [{ id: '1', name: 'A', threshold: 0, cashback: 101, enabled: true }]
    expect(validateLevels(levels)).toContain('Кэшбэк должен быть от 0 до 100%')
  })
})
