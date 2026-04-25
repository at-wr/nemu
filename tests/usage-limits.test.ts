import { describe, expect, it } from 'bun:test'
import {
  dayBucket,
  getCategoryLimits,
  isAdminUser,
  limitsDisabled,
  msUntilNextUtcMidnight,
  USAGE_CATEGORY_DEFAULTS,
} from '../convex/usage_limits'

describe('usage_limits helpers', () => {
  it('produces stable UTC-day buckets', () => {
    // Both timestamps fall within the same UTC day (2024-05-10).
    const a = dayBucket(Date.UTC(2024, 4, 10, 1, 0, 0))
    const b = dayBucket(Date.UTC(2024, 4, 10, 23, 59, 0))
    expect(a).toBe('2024-05-10')
    expect(b).toBe('2024-05-10')

    // A timestamp one minute into the next UTC day must roll over.
    const c = dayBucket(Date.UTC(2024, 4, 11, 0, 1, 0))
    expect(c).toBe('2024-05-11')
  })

  it('computes time until next UTC midnight', () => {
    const oneHourBefore = Date.UTC(2024, 4, 10, 23, 0, 0)
    expect(msUntilNextUtcMidnight(oneHourBefore)).toBe(60 * 60 * 1000)
  })

  it('falls back to documented defaults when no env overrides are set', () => {
    for (const category of ['chat', 'tts', 'llm'] as const) {
      const free = getCategoryLimits({}, category, 'free')
      const donor = getCategoryLimits({}, category, 'donor')
      const defaults = USAGE_CATEGORY_DEFAULTS[category]
      expect(free.user).toBe(defaults.free)
      expect(free.global).toBe(defaults.global)
      expect(donor.user).toBe(defaults.donor)
      expect(donor.global).toBe(defaults.global)
    }
  })

  it('admin tier has no effective cap', () => {
    const limits = getCategoryLimits({}, 'chat', 'admin')
    expect(limits.user).toBe(Number.POSITIVE_INFINITY)
    expect(limits.global).toBe(Number.POSITIVE_INFINITY)
  })

  it('applies env overrides per tier + scope', () => {
    const env = {
      USAGE_LIMIT_CHAT_FREE: '5',
      USAGE_LIMIT_CHAT_DONOR: '9',
      USAGE_LIMIT_CHAT_GLOBAL: '100',
    }
    expect(getCategoryLimits(env, 'chat', 'free').user).toBe(5)
    expect(getCategoryLimits(env, 'chat', 'donor').user).toBe(9)
    expect(getCategoryLimits(env, 'chat', 'free').global).toBe(100)
  })

  it('ignores malformed env overrides', () => {
    const env = { USAGE_LIMIT_CHAT_FREE: 'not-a-number' }
    expect(getCategoryLimits(env, 'chat', 'free').user).toBe(
      USAGE_CATEGORY_DEFAULTS.chat.free,
    )
  })

  it('recognises admin users from env', () => {
    expect(isAdminUser({ USAGE_ADMIN_USER_IDS: 'alice, bob' }, 'alice')).toBe(true)
    expect(isAdminUser({ USAGE_ADMIN_USER_IDS: 'alice, bob' }, 'carol')).toBe(false)
    expect(isAdminUser({}, 'alice')).toBe(false)
  })

  it('honors the global disable switch', () => {
    expect(limitsDisabled({ USAGE_LIMITS_DISABLED: 'true' })).toBe(true)
    expect(limitsDisabled({ USAGE_LIMITS_DISABLED: 'false' })).toBe(false)
    expect(limitsDisabled({})).toBe(false)
  })
})
