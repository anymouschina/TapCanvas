import { describe, expect, it } from 'vitest'
import { SkillMarketplaceResponseDtoSchema } from './server'

describe('SkillMarketplaceResponseDtoSchema', () => {
	it('accepts a rolling-version response without canListSkills', () => {
		const parsed = SkillMarketplaceResponseDtoSchema.parse({
			configured: false,
			config: {
				purchaseWeight: 1,
				freshnessWeight: 0,
				freshnessHalfLifeDays: 30,
				items: {},
			},
			creditBalance: 0,
			items: [],
		})

		expect(parsed.canListSkills).toBeUndefined()
	})
})
