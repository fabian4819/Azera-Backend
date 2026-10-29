import { Router, Response } from 'express'
import crypto from 'crypto'
import ExcelJS from 'exceljs'
import { Types } from 'mongoose'
import { connectDB } from '../../db/connect'
import { requireAuth, requireRole, AuthRequest } from '../../middleware/auth'
import DocumentModel from '../documents/document.model'
import { invoiceTotals } from '../documents/docTemplates'
import Campaign from '../campaigns/campaign.model'
import Tenant from '../tenants/tenant.model'
import { getCampaignFinance } from './financeRecord.routes'
import type { InternalCost } from '../documents/invoiceBot.service'

/**
 * Rekap Keuangan (khusus owner): uang masuk dari invoice menu Document yang sudah lunas, uang keluar
 * dari FinanceRecord campaign (fee creator/PIC/MG otomatis dari Recap Payment + reimburse/ads/opex).
 * Data rekap invoice disimpan di Document.data.recap (tidak ikut tercetak di PDF), tier di items[i].tier.
 */
const router = Router()
router.use(requireAuth, requireRole('owner'))

type ColumnType = 'text' | 'income' | 'expense'
interface Column { key: string; label: string; type: ColumnType }
export interface InvoiceRecap {
  status?: 'unpaid' | 'paid'
  paidAt?: string
  campaignId?: string
  runningMonth?: string
  custom?: Record<string, string | number>
  /** Disembunyikan dari rekap (tidak ikut total/export), bisa dipulihkan. Invoice-nya tetap ada. */
  hidden?: boolean
  /** Biaya internal dari template WA `/invoice` (Total Fee KOL/PIC/Handle by/Gaji Admin) */
  internalCost?: InternalCost
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-\d{2}$/
const COLUMN_TYPES: ColumnType[] = ['text', 'income', 'expense']
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => Number(v) || 0

async function getColumns(tenantId: string): Promise<Column[]> {
  const tenant = await Tenant.findById(tenantId).select('settings.financeRecapColumns')
  return (tenant?.settings?.financeRecapColumns || []).map((c) => ({ key: c.key, label: c.label, type: c.type }))
}

const todayJakarta = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })

export interface RecapGroup {
  key: string; campaignId: string | null; campaign: string; company: string; contact: string; mastersheetUrl: string
  runningMonth: string; items: { sow: string; tier: string; qty: number; unitFee: number; amount: number }[]
  invoices: { _id: string; number: string; issueDate: string; dueDate: string; total: number; paid: boolean; paidAt: string; overdue: boolean }[]
  custom: Record<string, string | number>; totalInvoice: number; income: number; receivable: number
  expense: { feeCreator: number; feePic: number; feeMg: number; feeHandle: number; adminInternal: number; reimburse: number; ads: number; opex: number; custom: number; total: number }
  /** Keterangan Gaji Admin dari invoice WA */
  adminNote: string
  profit: number; margin: number | null
  /** Creator fully-approved di campaign vs talent di invoice; talentWarning terisi kalau tidak cocok */
  approvedCreators: number | null; talentWarning: string
  hidden: boolean
}

/** Rekap per campaign untuk periode tanggal invoice [from, to] (YYYY-MM-DD, opsional). Dipakai GET / dan export. */
export async function buildRecap(tenantId: string, from: string, to: string, showHidden = false) {
  // Periode = tanggal invoice (data.issueDate, string YYYY-MM-DD → perbandingan string aman)
  const filter: Record<string, unknown> = { tenantId, type: 'invoice' }
  if (from || to) filter['data.issueDate'] = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
  const [docs, columns] = await Promise.all([DocumentModel.find(filter).sort({ 'data.issueDate': -1, _id: -1 }), getColumns(tenantId)])

  const campaignIds = [...new Set(docs.map((d) => str((d.data.recap as InvoiceRecap | undefined)?.campaignId)).filter((id) => Types.ObjectId.isValid(id)))]
  const campaigns = await Campaign.find({ tenantId, _id: { $in: campaignIds } }).select('name')
  const campaignName = new Map(campaigns.map((c) => [String(c._id), c.name]))
  // ponytail: 1 sync FinanceRecord per campaign per request, cukup untuk puluhan campaign/periode; agregasi kalau ratusan
  const finances = new Map(await Promise.all([...campaignName.keys()].map(async (id) => [id, await getCampaignFinance(id, tenantId)] as const)))
  const today = todayJakarta()
  const groups = new Map<string, RecapGroup>()

  const hiddenCount = docs.filter((d) => (d.data.recap as InvoiceRecap | undefined)?.hidden).length
  for (const doc of docs) {
    const d = doc.data
    const recap = (d.recap || {}) as InvoiceRecap
    if (recap.hidden && !showHidden) continue
    const cid = campaignName.has(str(recap.campaignId)) ? str(recap.campaignId) : null
    // Invoice tersembunyi dikelompokkan terpisah supaya tidak tercampur dengan grup yang dihitung
    const key = `${recap.hidden ? 'hidden:' : ''}${cid || String(doc._id)}`
    const billTo = (d.billTo || {}) as Record<string, unknown>
    let g = groups.get(key)
    if (!g) {
      const fin = cid ? finances.get(cid) : undefined
      g = {
        key, campaignId: cid,
        campaign: (cid && campaignName.get(cid)) || str(d.campaign) || str(d.reference) || '-',
        company: str(billTo.name), contact: [str(billTo.pic), str(billTo.contact)].filter(Boolean).join(' · '),
        mastersheetUrl: str(d.mastersheetUrl), runningMonth: str(recap.runningMonth) || str(d.issueDate).slice(0, 7),
        items: [], invoices: [], custom: {}, totalInvoice: 0, income: 0, receivable: 0,
        expense: {
          feeCreator: fin?.feeCreator || 0, feePic: fin?.feePic || 0, feeMg: fin?.feeMg || 0, feeHandle: 0, adminInternal: 0,
          reimburse: fin?.reimburse || 0, ads: fin?.ads || 0, opex: fin?.opex || 0, custom: 0, total: 0,
        },
        adminNote: '', profit: 0, margin: null,
        approvedCreators: fin ? fin.auto.acceptedCount : null, talentWarning: '',
        hidden: !!recap.hidden,
      }
      groups.set(key, g)
    }
    g.mastersheetUrl ||= str(d.mastersheetUrl)

    // Biaya internal invoice WA. Fee KOL/PIC: Recap Payment campaign (kalau ada) yang dipakai, supaya tidak dobel.
    const ic = recap.internalCost
    if (ic) {
      const fin = cid ? finances.get(cid) : undefined
      if (!fin?.feeCreator) g.expense.feeCreator += num(ic.feeKol)
      if (!fin?.feePic) g.expense.feePic += num(ic.feePic)
      g.expense.feeHandle += num(ic.feeHandle)
      g.expense.adminInternal += num(ic.adminInternal)
      if (ic.adminNote) g.adminNote = [g.adminNote, ic.adminNote].filter(Boolean).join('; ')
    }

    const { rows, total } = invoiceTotals(d)
    for (const r of rows) {
      g.items.push({ sow: [str(r.it.name), str(r.it.description)].filter(Boolean).join(' - '), tier: str(r.it.tier), qty: r.qty, unitFee: r.unitFee, amount: r.amount })
    }
    const paid = recap.status === 'paid'
    const dueDate = str(d.dueDate)
    g.invoices.push({ _id: String(doc._id), number: str(d.number), issueDate: str(d.issueDate), dueDate, total, paid, paidAt: str(recap.paidAt), overdue: !paid && !!dueDate && dueDate < today })
    g.totalInvoice += total
    if (paid) g.income += total; else g.receivable += total

    for (const col of columns) {
      const v = recap.custom?.[col.key]
      if (v === undefined || v === '') continue
      if (col.type === 'text') { g.custom[col.key] = [g.custom[col.key], String(v)].filter(Boolean).join(', '); continue }
      g.custom[col.key] = num(g.custom[col.key]) + num(v)
      // Kolom uang masuk tambahan ikut status lunas invoice-nya; uang keluar tambahan selalu dihitung
      if (col.type === 'income' && paid) g.income += num(v)
      if (col.type === 'expense') g.expense.custom += num(v)
    }
  }

  const list = [...groups.values()].map((g) => {
    const e = g.expense
    e.total = e.feeCreator + e.feePic + e.feeMg + e.feeHandle + e.adminInternal + e.reimburse + e.ads + e.opex + e.custom
    g.profit = g.income - e.total
    g.margin = g.income > 0 ? Math.round((g.profit / g.income) * 1000) / 10 : null
    g.talentWarning = talentWarning(g)
    return g
  })
  const counted = list.filter((g) => !g.hidden)
  const sum = (f: (g: RecapGroup) => number) => counted.reduce((s, g) => s + f(g), 0)
  const income = sum((g) => g.income), expense = sum((g) => g.expense.total)
  return {
    columns,
    groups: list,
    totals: {
      income, expense, profit: income - expense,
      margin: income > 0 ? Math.round(((income - expense) / income) * 1000) / 10 : null,
      receivable: sum((g) => g.receivable),
      overdue: sum((g) => g.invoices.filter((i) => i.overdue).reduce((s, i) => s + i.total, 0)),
      invoiceCount: docs.length - hiddenCount,
      paidCount: counted.reduce((s, g) => s + g.invoices.filter((i) => i.paid).length, 0),
      hiddenCount,
    },
  }
}

/**
 * Talent di invoice vs creator fully-approved. Satu creator bisa ambil beberapa SOW, jadi rentang wajar =
 * [qty SOW terbesar, total qty semua SOW]; baris Reimburse Produk & tanpa qty talent tidak dihitung.
 * ponytail: heuristik rentang, ganti dengan mapping creator↔SOW kalau data itu nanti ada.
 */
export function talentWarning(g: Pick<RecapGroup, 'approvedCreators' | 'items'>): string {
  if (g.approvedCreators === null) return ''
  const qtys = g.items.filter((i) => !/reimburse/i.test(i.tier) && !/reimburse|beli produk/i.test(i.sow)).map((i) => i.qty)
  if (!qtys.length) return ''
  const min = Math.max(...qtys), max = qtys.reduce((a, b) => a + b, 0)
  const n = g.approvedCreators
  if (n < min) return `Creator di-approve baru ${n}, invoice butuh minimal ${min} talent`
  if (n > max) return `Creator di-approve ${n}, lebih banyak dari total talent di invoice (${max})`
  return ''
}

function parseRange(req: AuthRequest) {
  const from = str(req.query.from), to = str(req.query.to)
  return (from && !YMD.test(from)) || (to && !YMD.test(to)) ? null : { from, to }
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const range = parseRange(req)
    if (!range) { res.status(400).json({ message: 'from/to harus YYYY-MM-DD' }); return }
    res.json(await buildRecap(req.auth!.tenantId as string, range.from, range.to, req.query.showHidden === '1'))
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: (err as Error).message })
  }
})

/** Export Excel, isi & urutan kolom sama dengan tabel di halaman Rekap Keuangan (1 baris per SOW, sel campaign di-merge). */
router.get('/export', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const range = parseRange(req)
    if (!range) { res.status(400).json({ message: 'from/to harus YYYY-MM-DD' }); return }
    const { columns, groups, totals } = await buildRecap(req.auth!.tenantId as string, range.from, range.to)

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rekap Keuangan')
    const RP = '"Rp"#,##0;-"Rp"#,##0'
    const head = ['Campaign', 'Perusahaan', 'Contact', 'Bulan Running', 'Master Sheet', 'SOW', 'Tier', 'Jumlah Talent', 'Fee/Talent', 'Total',
      'Total Payment', 'Invoice', 'Status', 'Jatuh Tempo', ...columns.map((c) => c.label), 'Fee Creator', 'Fee PIC', 'Fee MG', 'Fee Handle by', 'Gaji Admin Internal', 'Reimburse', 'Ads', 'Opex',
      'Uang Keluar', 'Profit', 'Margin (%)', 'Catatan Talent', 'Ket. Gaji Admin']
    ws.addRow([`Rekap Keuangan ${range.from || 'awal'} s/d ${range.to || 'sekarang'}`]).font = { bold: true, size: 13 }
    ws.addRow([`Uang Masuk ${totals.income} · Uang Keluar ${totals.expense} · Profit ${totals.profit} · Piutang ${totals.receivable}`])
    ws.addRow([])
    const headerRow = ws.addRow(head)
    headerRow.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFFF' } } })

    // Kolom per grup (di-merge vertikal) vs per item SOW
    const ITEM_COLS = new Set([6, 7, 8, 9, 10])
    // Fee/Talent, Total, Total Payment, kolom tambahan uang, Fee Creator s/d Profit (10 kolom)
    const moneyCols = [9, 10, 11, ...columns.flatMap((c, i) => (c.type === 'text' ? [] : [15 + i])), ...Array.from({ length: 10 }, (_, i) => 15 + columns.length + i)]
    for (const g of groups) {
      const items = g.items.length ? g.items : [null]
      const e = g.expense
      const groupValues = [
        g.campaign, g.company, g.contact, g.runningMonth, g.mastersheetUrl,
        null, null, null, null, null,
        g.totalInvoice, g.invoices.map((i) => i.number).join('\n'),
        g.invoices.map((i) => (i.paid ? `Lunas ${i.paidAt}` : 'Belum Lunas')).join('\n'),
        g.invoices.map((i) => (i.dueDate ? `${i.dueDate}${i.overdue ? ' (lewat)' : ''}` : '-')).join('\n'),
        ...columns.map((c) => g.custom[c.key] ?? ''),
        e.feeCreator, e.feePic, e.feeMg, e.feeHandle, e.adminInternal, e.reimburse, e.ads, e.opex, e.total, g.profit, g.margin ?? '', g.talentWarning, g.adminNote,
      ]
      const first = ws.rowCount + 1
      items.forEach((it, i) => {
        const row = groupValues.map((v, col) => {
          if (ITEM_COLS.has(col + 1)) return it ? [it.sow, it.tier, it.qty, it.unitFee, it.amount][col - 5] : ''
          return i === 0 ? v : null
        })
        const r = ws.addRow(row)
        r.alignment = { vertical: 'middle', wrapText: true }
        moneyCols.forEach((c) => { r.getCell(c).numFmt = RP })
      })
      if (items.length > 1) {
        for (let col = 1; col <= head.length; col++) if (!ITEM_COLS.has(col)) ws.mergeCells(first, col, ws.rowCount, col)
      }
    }
    ws.columns.forEach((c, i) => { c.width = [22, 20, 20, 12, 28, 30][i] ?? 14 })

    const name = `rekap-keuangan_${range.from || 'awal'}_${range.to || 'sekarang'}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(Buffer.from(await wb.xlsx.writeBuffer()))
  } catch (err) {
    res.status(500).json({ message: 'Gagal export', error: (err as Error).message })
  }
})

/** Ubah Data Rekap satu invoice (status lunas, jatuh tempo, campaign, bulan running, kolom tambahan, sembunyikan). Field yang tidak dikirim tetap. */
router.patch('/invoices/:id', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const tenantId = req.auth!.tenantId as string
    const doc = await DocumentModel.findOne({ _id: req.params.id, tenantId, type: 'invoice' })
    if (!doc) { res.status(404).json({ message: 'Invoice tidak ditemukan' }); return }
    const body = req.body as Record<string, unknown>
    const recap: InvoiceRecap = { ...((doc.data.recap || {}) as InvoiceRecap) }
    const extra: Record<string, unknown> = {}

    if ('status' in body) {
      if (body.status !== 'paid' && body.status !== 'unpaid') { res.status(400).json({ message: 'status tidak valid' }); return }
      recap.status = body.status
      if (body.status === 'unpaid') delete recap.paidAt
      else if (!recap.paidAt) recap.paidAt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
    }
    if ('paidAt' in body) {
      const v = str(body.paidAt)
      if (v && !YMD.test(v)) { res.status(400).json({ message: 'paidAt harus YYYY-MM-DD' }); return }
      if (v) recap.paidAt = v
    }
    // Jatuh tempo = field invoice itu sendiri (ikut tercetak di PDF), bukan bagian data.recap
    if ('dueDate' in body) {
      const v = str(body.dueDate)
      if (v && !YMD.test(v)) { res.status(400).json({ message: 'dueDate harus YYYY-MM-DD' }); return }
      extra.dueDate = v
    }
    if ('hidden' in body) {
      if (body.hidden) recap.hidden = true
      else delete recap.hidden
    }
    if ('runningMonth' in body) {
      const v = str(body.runningMonth)
      if (v && !YM.test(v)) { res.status(400).json({ message: 'runningMonth harus YYYY-MM' }); return }
      recap.runningMonth = v || undefined
    }
    if ('campaignId' in body) {
      const v = str(body.campaignId)
      if (v && !(Types.ObjectId.isValid(v) && (await Campaign.exists({ _id: v, tenantId })))) { res.status(400).json({ message: 'Campaign tidak ditemukan' }); return }
      recap.campaignId = v || undefined
    }
    if (body.custom && typeof body.custom === 'object') {
      const columns = await getColumns(tenantId)
      const custom = { ...(recap.custom || {}) }
      for (const [k, v] of Object.entries(body.custom as Record<string, unknown>)) {
        const col = columns.find((c) => c.key === k)
        if (!col) continue
        if (v === '' || v === null) delete custom[k]
        else custom[k] = col.type === 'text' ? String(v).slice(0, 500) : num(v)
      }
      recap.custom = custom
    }

    doc.data = { ...doc.data, ...extra, recap }
    doc.markModified('data')
    await doc.save()
    res.json({ _id: doc._id, recap, dueDate: doc.data.dueDate ?? '' })
  } catch {
    res.status(500).json({ message: 'Gagal menyimpan data rekap' })
  }
})

router.get('/columns', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    res.json(await getColumns(req.auth!.tenantId as string))
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
})

/** Ganti seluruh daftar kolom tambahan. Kolom yang dihapus: nilainya tetap di invoice, cuma tidak ditampilkan/dihitung. */
router.put('/columns', async (req: AuthRequest, res: Response) => {
  try {
    await connectDB()
    const input = (req.body as { columns?: unknown }).columns
    if (!Array.isArray(input) || input.length > 20) { res.status(400).json({ message: 'columns maksimal 20' }); return }
    const columns: Column[] = []
    for (const raw of input as Record<string, unknown>[]) {
      const label = str(raw?.label).slice(0, 60)
      const type = raw?.type as ColumnType
      if (!label || !COLUMN_TYPES.includes(type)) { res.status(400).json({ message: 'Tiap kolom wajib punya nama & jenis' }); return }
      columns.push({ key: str(raw.key) || `c_${crypto.randomBytes(4).toString('hex')}`, label, type })
    }
    await Tenant.updateOne({ _id: req.auth!.tenantId }, { $set: { 'settings.financeRecapColumns': columns } })
    res.json(columns)
  } catch {
    res.status(500).json({ message: 'Gagal menyimpan kolom' })
  }
})

export default router
