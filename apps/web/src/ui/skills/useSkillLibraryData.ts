import React from 'react'
import {
	deleteUserContextAsset,
	getSkillMarketplaceSellerDashboard,
	getSkillMarketplaceSellerListings,
	getSkillMarketplace,
	getSkillMarketplaceListingEligibility,
	getUserContextAssetContent,
	listUserContextAssetOnMarketplace,
	listUserContextAssets,
	purchaseMarketplaceSkill,
	unlistUserContextAssetFromMarketplace,
	updateUserContextAsset,
  uploadUserContextAsset,
  type AgentSkillDto,
	type SkillMarketplaceItemDto,
	type PurchaseMarketplaceSkillResponseDto,
	type SkillMarketplaceSellerDashboardDto,
	type SkillMarketplaceSellerListingDto,
  type UserContextAssetDto,
} from '../../api/server'
import { useAuth } from '../../auth/store'

type SkillLibrarySnapshot = {
  official: AgentSkillDto[]
  personal: UserContextAssetDto[]
	marketplace: SkillMarketplaceItemDto[]
	creditBalance: number
	canListSkills: boolean
	sellerListings: SkillMarketplaceSellerListingDto[]
}

const skillLibraryRequests = new Map<string, Promise<SkillLibrarySnapshot>>()
const skillSellerDashboardRequests = new Map<string, Promise<SkillMarketplaceSellerDashboardDto>>()

function loadSkillLibrarySnapshot(authScope: string | null): Promise<SkillLibrarySnapshot> {
  const key = authScope || 'anonymous'
  const current = skillLibraryRequests.get(key)
  if (current) return current
	const request = Promise.all([
		listUserContextAssets(),
		getSkillMarketplace(),
		getSkillMarketplaceListingEligibility(),
		getSkillMarketplaceSellerListings(),
	]).then(([personal, marketplace, canListSkills, sellerListings]) => ({
    official: marketplace.items
      .filter((item) => item.sourceType === 'official' && item.owned)
      .map((item) => item.skill),
		personal,
		marketplace: marketplace.items,
		creditBalance: marketplace.creditBalance,
		canListSkills,
		sellerListings,
  })).finally(() => {
    if (skillLibraryRequests.get(key) === request) skillLibraryRequests.delete(key)
  })
  skillLibraryRequests.set(key, request)
  return request
}

function loadSkillSellerDashboard(authScope: string | null): Promise<SkillMarketplaceSellerDashboardDto> {
  const key = authScope || 'anonymous'
  const current = skillSellerDashboardRequests.get(key)
  if (current) return current
  const request = getSkillMarketplaceSellerDashboard().finally(() => {
    if (skillSellerDashboardRequests.get(key) === request) {
      skillSellerDashboardRequests.delete(key)
    }
  })
  skillSellerDashboardRequests.set(key, request)
  return request
}

function sortOfficialSkills(skills: AgentSkillDto[]): AgentSkillDto[] {
  return skills
    .filter((skill) => skill.enabled !== false && skill.visible !== false)
    .sort((left, right) => {
      const leftOrder = typeof left.sortOrder === 'number' ? left.sortOrder : Number.MAX_SAFE_INTEGER
      const rightOrder = typeof right.sortOrder === 'number' ? right.sortOrder : Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return String(left.name || left.key).localeCompare(String(right.name || right.key), 'zh-CN')
    })
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

export type SkillLibraryData = {
  officialSkills: AgentSkillDto[]
  personalSkills: UserContextAssetDto[]
	marketplaceItems: SkillMarketplaceItemDto[]
	creditBalance: number
	canListSkills: boolean
	sellerListings: SkillMarketplaceSellerListingDto[]
	sellerDashboard: SkillMarketplaceSellerDashboardDto
  loading: boolean
  uploading: boolean
  updatingPersonalId: string
  listingPersonalId: string
  purchasingProductId: string
	error: string
	sellerDashboardError: string
  load: () => Promise<void>
	uploadPersonalSkill: (input: SkillAssetDraft) => Promise<UserContextAssetDto | null>
	loadPersonalSkillContent: (assetId: string) => Promise<string | null>
  updatePersonalSkill: (skill: UserContextAssetDto, input: SkillAssetDraft) => Promise<UserContextAssetDto | null>
	deletePersonalSkill: (skill: UserContextAssetDto) => Promise<boolean>
	listPersonalSkill: (skill: UserContextAssetDto, priceCredits: number, category: string) => Promise<boolean>
	unlistPersonalSkill: (skill: UserContextAssetDto) => Promise<boolean>
	purchaseSkill: (item: SkillMarketplaceItemDto) => Promise<PurchaseMarketplaceSkillResponseDto | null>
}

export type SkillAssetDraft = {
	fileName: string
	content: string
	name: string
	description: string
	logoUrl: string
	overwrite: boolean
}

export function useSkillLibraryData(): SkillLibraryData {
  const auth = useAuth()
  const [officialSkills, setOfficialSkills] = React.useState<AgentSkillDto[]>([])
  const [personalSkills, setPersonalSkills] = React.useState<UserContextAssetDto[]>([])
	const [marketplaceItems, setMarketplaceItems] = React.useState<SkillMarketplaceItemDto[]>([])
	const [creditBalance, setCreditBalance] = React.useState(0)
	const [canListSkills, setCanListSkills] = React.useState(false)
	const [sellerListings, setSellerListings] = React.useState<SkillMarketplaceSellerListingDto[]>([])
	const [sellerDashboard, setSellerDashboard] = React.useState<SkillMarketplaceSellerDashboardDto>({
		listedCount: 0,
		soldCount: 0,
		totalIncomeCredits: 0,
		recentSales: [],
	})
  const [loading, setLoading] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [updatingPersonalId, setUpdatingPersonalId] = React.useState('')
  const [listingPersonalId, setListingPersonalId] = React.useState('')
  const [purchasingProductId, setPurchasingProductId] = React.useState('')
  const [error, setError] = React.useState('')
  const [sellerDashboardError, setSellerDashboardError] = React.useState('')

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    setSellerDashboardError('')
    try {
		const { official, personal, marketplace, creditBalance: balance, canListSkills: listingAllowed, sellerListings: listings } = await loadSkillLibrarySnapshot(auth.token)
      setOfficialSkills(sortOfficialSkills(official))
      setPersonalSkills(personal)
		setMarketplaceItems(marketplace)
			setCreditBalance(balance)
			setCanListSkills(listingAllowed)
			setSellerListings(listings)
    } catch (loadError: unknown) {
      setOfficialSkills([])
      setPersonalSkills([])
		setMarketplaceItems([])
			setCreditBalance(0)
			setCanListSkills(false)
			setSellerListings([])
      setError(resolveErrorMessage(loadError, '技能库加载失败'))
		setLoading(false)
		return
	}
	try {
		setSellerDashboard(await loadSkillSellerDashboard(auth.token))
	} catch (dashboardError: unknown) {
		setSellerDashboardError(resolveErrorMessage(dashboardError, '加载 Skill 积分收入失败'))
    } finally {
      setLoading(false)
    }
  }, [auth.token])

	const uploadPersonalSkill = React.useCallback(async (input: SkillAssetDraft): Promise<UserContextAssetDto | null> => {
		setUploading(true)
		setError('')
		try {
			const created = await uploadUserContextAsset(input)
			setPersonalSkills((current) => [created, ...current.filter((skill) => skill.id !== created.id)])
			return created
		} catch (uploadError: unknown) {
			setError(resolveErrorMessage(uploadError, '上传 Skill 失败'))
			return null
		} finally {
			setUploading(false)
		}
	}, [])

	const loadPersonalSkillContent = React.useCallback(async (assetId: string): Promise<string | null> => {
		setError('')
		try {
			return (await getUserContextAssetContent(assetId)).content
		} catch (loadError: unknown) {
			setError(resolveErrorMessage(loadError, '加载 Skill 指令失败'))
			return null
		}
	}, [])

	const updatePersonalSkill = React.useCallback(async (
		skill: UserContextAssetDto,
		input: SkillAssetDraft,
	): Promise<UserContextAssetDto | null> => {
		setUpdatingPersonalId(skill.id)
		setError('')
		try {
			const updated = await updateUserContextAsset({
				assetId: skill.id,
				name: input.name,
				description: input.description || null,
				logoUrl: input.logoUrl,
				content: input.content,
			})
			setPersonalSkills((current) => current.map((item) => item.id === updated.id ? updated : item))
			return updated
		} catch (updateError: unknown) {
			setError(resolveErrorMessage(updateError, '更新 Skill 失败'))
			return null
		} finally {
			setUpdatingPersonalId('')
		}
	}, [])

	const deletePersonalSkill = React.useCallback(async (skill: UserContextAssetDto): Promise<boolean> => {
		setUpdatingPersonalId(skill.id)
		setError('')
		try {
			await deleteUserContextAsset(skill.id)
			setPersonalSkills((current) => current.filter((item) => item.id !== skill.id))
			return true
		} catch (deleteError: unknown) {
			setError(resolveErrorMessage(deleteError, '卸载 Skill 失败'))
			return false
		} finally {
			setUpdatingPersonalId('')
		}
	}, [])

	const purchaseSkill = React.useCallback(async (item: SkillMarketplaceItemDto): Promise<PurchaseMarketplaceSkillResponseDto | null> => {
		if (!item.productId || !item.purchasable) {
			setError('该 Skill 尚未配置可购买商品')
			return null
    }
    setPurchasingProductId(item.productId)
    setError('')
    try {
		const purchase = await purchaseMarketplaceSkill(item.productId)
		setCreditBalance(purchase.creditBalance)
		setPersonalSkills((current) => current.some((skill) => skill.id === purchase.installedAsset.id)
			? current
			: [purchase.installedAsset, ...current])
		setMarketplaceItems((current) => current.map((candidate) => candidate.productId === item.productId
			? {
				...candidate,
				owned: true,
				realPurchaseCount: candidate.realPurchaseCount + (purchase.status === 'purchased' ? 1 : 0),
			}
			: candidate))
		return purchase
	} catch (purchaseError: unknown) {
		setError(resolveErrorMessage(purchaseError, '购买 Skill 失败'))
		return null
    } finally {
      setPurchasingProductId('')
    }
  }, [])

	const listPersonalSkill = React.useCallback(async (
		skill: UserContextAssetDto,
		priceCredits: number,
		category: string,
	): Promise<boolean> => {
		if (!Number.isInteger(priceCredits) || priceCredits < 1) {
			setError('Skill 积分售价必须是正整数')
			return false
		}
    setListingPersonalId(skill.id)
    setError('')
	try {
			const updated = await listUserContextAssetOnMarketplace({ assetId: skill.id, priceCredits, category })
      setPersonalSkills((current) => current.map((item) => item.id === updated.id ? updated : item))
		const marketplace = await getSkillMarketplace()
		setMarketplaceItems(marketplace.items)
			setCreditBalance(marketplace.creditBalance)
			setCanListSkills(await getSkillMarketplaceListingEligibility())
			setSellerListings(await getSkillMarketplaceSellerListings())
		try {
			setSellerDashboard(await getSkillMarketplaceSellerDashboard())
			setSellerDashboardError('')
			} catch (dashboardError: unknown) {
			setSellerDashboardError(resolveErrorMessage(dashboardError, '加载 Skill 积分收入失败'))
			}
			return true
		} catch (listingError: unknown) {
			setError(resolveErrorMessage(listingError, 'Skill 上架失败'))
			return false
    } finally {
      setListingPersonalId('')
    }
	}, [])

		const unlistPersonalSkill = React.useCallback(async (skill: UserContextAssetDto): Promise<boolean> => {
		setListingPersonalId(skill.id)
		setError('')
		try {
			const updated = await unlistUserContextAssetFromMarketplace(skill.id)
			setPersonalSkills((current) => current.map((item) => item.id === updated.id ? updated : item))
			const marketplace = await getSkillMarketplace()
			setMarketplaceItems(marketplace.items)
			setCreditBalance(marketplace.creditBalance)
			setCanListSkills(await getSkillMarketplaceListingEligibility())
			setSellerListings(await getSkillMarketplaceSellerListings())
				setSellerDashboard(await getSkillMarketplaceSellerDashboard())
				setSellerDashboardError('')
				return true
			} catch (unlistError: unknown) {
				setError(resolveErrorMessage(unlistError, 'Skill 下架失败'))
				return false
			} finally {
			setListingPersonalId('')
		}
	}, [])

	return {
    officialSkills,
    personalSkills,
		marketplaceItems,
		creditBalance,
		canListSkills,
		sellerListings,
		sellerDashboard,
    loading,
    uploading,
    updatingPersonalId,
    listingPersonalId,
    purchasingProductId,
		error,
		sellerDashboardError,
    load,
		uploadPersonalSkill,
		loadPersonalSkillContent,
		updatePersonalSkill,
		deletePersonalSkill,
		listPersonalSkill,
		unlistPersonalSkill,
    purchaseSkill,
	}
}
