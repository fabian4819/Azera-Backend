/**
 * Nama penagihan klien Pintarnya dibakukan: semua variasi ("Pintarnya", "PT Pintarnya Indonesia",
 * "Pintarnya / Autenticity", "Pintarnya/ Pikopi", "PDS Digital Agency") ditulis "Pintarnya (PDS Digital Agency)".
 * Dipakai saat invoice dibuat/diubah (menu Document & bot /invoice) dan tab Pintarnya di sheet Rekap Keuangan.
 */
export const PINTARNYA_NAME = 'Pintarnya (PDS Digital Agency)'

export const isPintarnyaClient = (name: string) => /pintarnya|pds\s*digital/i.test(name)

export const normalizeClientName = (name: string) => (isPintarnyaClient(name) ? PINTARNYA_NAME : name)
