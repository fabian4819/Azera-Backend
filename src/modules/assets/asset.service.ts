import { Types } from 'mongoose'
import Campaign from '../campaigns/campaign.model'
import DocumentModel from '../documents/document.model'
import Invoice from '../finance/invoice.model'
import Submission from '../submissions/submission.model'
import Asset, { AssetCategory } from './asset.model'

export interface LibraryItem {
  id: string
  category: AssetCategory
  label: string
  fileUrl?: string
  content?: string
  tags: string[]
  source: 'manual' | 'auto'
  createdAt: Date
}

/**
 * AD-33: gabungan file upload manual (Asset) + dokumen yang sudah otomatis
 * dihasilkan modul lain (brief, insight screenshot, draft/final content link,
 * report PDF, invoice PDF, case study) — supaya admin tidak perlu cari manual
 * di Google Drive, semua kategori tampil di satu tempat per campaign.
 */
export async function getAssetLibrary(campaignId: string | Types.ObjectId, tenantId: string | Types.ObjectId): Promise<LibraryItem[]> {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId })
  if (!campaign) return []

  const items: LibraryItem[] = []

  if (campaign.briefContent) {
    items.push({
      id: `brief-${campaign._id}`,
      category: 'brief',
      label: 'Brief Campaign',
      content: campaign.briefContent,
      tags: [],
      source: 'auto',
      createdAt: campaign.updatedAt,
    })
  }

  const submissions = await Submission.find({ tenantId, campaignId })
  for (const s of submissions) {
    if (s.link) {
      items.push({
        id: `submission-link-${s._id}`,
        category: s.type === 'draft' ? 'draft' : 'final_content',
        label: `${s.type === 'draft' ? 'Draft' : 'Final Content'} — ${s.platform}`,
        fileUrl: s.link,
        tags: [s.platform],
        source: 'auto',
        createdAt: s.createdAt,
      })
    }
    for (const [i, url] of s.insightScreenshotUrls.entries()) {
      items.push({
        id: `submission-insight-${s._id}-${i}`,
        category: 'insight',
        label: `Insight Screenshot — ${s.platform}`,
        fileUrl: url,
        tags: [s.platform],
        source: 'auto',
        createdAt: s.createdAt,
      })
    }
  }

  const documents = await DocumentModel.find({ tenantId, campaignId })
  for (const d of documents) {
    if (d.type === 'report' && d.pdfUrl) {
      items.push({ id: `doc-${d._id}`, category: 'final_report', label: 'Report PDF', fileUrl: d.pdfUrl, tags: [], source: 'auto', createdAt: d.createdAt })
    }
    if (d.type === 'case_study') {
      items.push({ id: `doc-${d._id}`, category: 'case_study', label: (d.data.headline as string) || 'Case Study', fileUrl: `/portfolio/case-study/${d._id}`, tags: [], source: 'auto', createdAt: d.createdAt })
    }
  }

  const invoices = await Invoice.find({ tenantId, campaignId })
  for (const inv of invoices) {
    if (inv.pdfUrl) {
      items.push({ id: `invoice-${inv._id}`, category: 'invoice', label: `Invoice ${inv.number}`, fileUrl: inv.pdfUrl, tags: [], source: 'auto', createdAt: inv.createdAt })
    }
  }

  const manualAssets = await Asset.find({ tenantId, campaignId }).sort({ createdAt: -1 })
  for (const a of manualAssets) {
    items.push({ id: String(a._id), category: a.category, label: a.fileName, fileUrl: a.fileUrl, tags: a.tags, source: 'manual', createdAt: a.createdAt })
  }

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}
