import Brand, { IBrand } from '../../models/Brand'

/**
 * Dipakai oleh dua sumber lead: form Brand di landing page (`routes/brands.ts`)
 * dan bot WhatsApp (`leadBot.service.ts`). Hanya menyimpan Brand — Campaign
 * dibuat manual oleh admin dari menu Campaigns.
 */
export async function createBrandInquiry(brandData: Partial<IBrand>): Promise<IBrand> {
  return Brand.create(brandData)
}
