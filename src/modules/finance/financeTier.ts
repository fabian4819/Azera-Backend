/** Fee Finance (dulu "Fee Handle by") per invoice, ditentukan jumlah talent di invoice. Batas = jumlah talent maksimal per tarif. */
export const FINANCE_TIERS: { label: string; max: number; fee: number }[] = [
  { label: 'Talent <50', max: 49, fee: 20_000 },
  { label: 'Talent 50-100', max: 100, fee: 40_000 },
  { label: 'Talent >100', max: 500, fee: 75_000 },
  { label: 'Talent >500', max: 1000, fee: 150_000 },
  { label: 'Talent >1000', max: 2000, fee: 200_000 },
  { label: 'Talent >2000', max: 3000, fee: 250_000 },
  { label: 'Talent >3000', max: Infinity, fee: 300_000 },
]

/** 0 talent (invoice tanpa qty talent) = 0, tidak ditebak */
export const financeFeeFor = (talents: number) => (talents > 0 ? FINANCE_TIERS.find((t) => talents <= t.max)!.fee : 0)

/** Item talent saja (reimburse / beli produk bukan talent), sama dengan talentWarning */
export const isTalentItem = (i: { item: string; sow: string; tier: string }) =>
  !/reimburse/i.test(i.tier) && !/reimburse|beli produk/i.test(`${i.item} ${i.sow}`)
