import crypto from 'crypto'
import Brand, { IBrand, BRAND_JASA_OPTIONS } from '../../models/Brand'
import Campaign from '../campaigns/campaign.model'
import { getDefaultTenant } from '../tenants/defaultTenant'

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `${base}-${crypto.randomBytes(3).toString('hex')}`
}

/**
 * Dipakai oleh dua sumber lead: form Brand di landing page (`routes/brands.ts`)
 * dan bot WhatsApp (`leadBot.service.ts`). Selain menyimpan Brand, otomatis bikin
 * draft Campaign (budget 0, admin isi angka nyata setelah follow-up) supaya lead
 * langsung muncul di dashboard admin (Campaigns list), bukan cuma tersimpan diam
 * di collection Brand — lihat AD-11.
 */
export async function createBrandInquiry(
  brandData: Partial<IBrand>,
  campaignName?: string,
  platforms?: string[]
): Promise<IBrand> {
  const brand = await Brand.create(brandData)

  if (campaignName) {
    const tenant = await getDefaultTenant()
    const jasaLabel = BRAND_JASA_OPTIONS.find((o) => o.key === brandData.jasa)?.label
    const tujuanLabel = (brandData.tujuan || []).join(', ') || jasaLabel || ''
    const objective = [tujuanLabel, brandData.deskripsi].filter(Boolean).join(' — ') || campaignName

    await Campaign.create({
      tenantId: tenant._id,
      brandId: brand._id,
      name: campaignName,
      objective,
      budget: 0,
      criteria: { niches: [], provinces: [], platforms: platforms || [] },
      applySlug: slugify(campaignName),
      accessCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
    })
  }

  return brand
}
