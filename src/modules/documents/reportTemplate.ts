import { ICampaign } from '../campaigns/campaign.model'
import { CampaignAnalytics } from '../campaigns/analytics.service'

interface CreatorSummary {
  name: string
  platform: string
  views: number
  engagement: number
}

interface ReportInput {
  campaign: ICampaign
  brandName: string
  analytics: CampaignAnalytics
  creators: CreatorSummary[]
}

function fmt(n: number): string {
  return n.toLocaleString('id-ID')
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * AD-26: laporan campaign, dirender ke PDF via Puppeteer (lib/pdf.ts).
 * Grafik performa pakai bar chart SVG sederhana, tanpa library charting.
 */
export function buildReportHtml({ campaign, brandName, analytics, creators }: ReportInput): string {
  const platforms = Object.entries(analytics.perPlatform)
  const maxViews = Math.max(1, ...platforms.map(([, s]) => s.views))
  const barWidth = 480

  const platformBars = platforms
    .map(([platform, s]) => {
      const w = Math.round((s.views / maxViews) * barWidth)
      return `
      <div class="bar-row">
        <div class="bar-label">${escape(platform)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${w}px"></div></div>
        <div class="bar-value">${fmt(s.views)} views</div>
      </div>`
    })
    .join('')

  const creatorRows = creators
    .map(
      (c) => `
      <tr>
        <td>${escape(c.name)}</td>
        <td>${escape(c.platform)}</td>
        <td>${fmt(c.views)}</td>
        <td>${fmt(c.engagement)}</td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #191c20; padding: 48px; }
  h1 { font-size: 28px; color: #6728e4; margin-bottom: 4px; }
  .sub { color: #777683; font-size: 13px; margin-bottom: 32px; }
  .section-title { font-size: 16px; font-weight: 700; color: #191c20; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e1e0ff; }
  .stat-grid { display: flex; gap: 12px; flex-wrap: wrap; }
  .stat-card { background: #f8f9ff; border: 1px solid #e1e0ff; border-radius: 12px; padding: 16px 20px; flex: 1; min-width: 140px; }
  .stat-label { font-size: 11px; color: #777683; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 700; color: #6728e4; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #181818; color: white; text-align: left; padding: 10px 14px; font-size: 12px; }
  td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #eee; }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .bar-label { width: 90px; font-size: 13px; text-transform: capitalize; }
  .bar-track { background: #eceef3; border-radius: 6px; height: 18px; }
  .bar-fill { background: linear-gradient(135deg, #6728e4, #814bfe); height: 18px; border-radius: 6px; }
  .bar-value { font-size: 12px; color: #777683; white-space: nowrap; }
  .insight-box { background: #f5f3ff; border: 1px solid #ddd8fe; border-radius: 12px; padding: 20px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e1e0ff; font-size: 11px; color: #777683; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <h1>Laporan Campaign — ${escape(campaign.name)}</h1>
  <div class="sub">${escape(brandName)} · ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>

  <div class="section-title">Ringkasan</div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Total Post</div><div class="stat-value">${analytics.totalPosts}</div></div>
    <div class="stat-card"><div class="stat-label">Total Views</div><div class="stat-value">${fmt(analytics.totalViews)}</div></div>
    <div class="stat-card"><div class="stat-label">Engagement Rate</div><div class="stat-value">${analytics.engagementRate}%</div></div>
    <div class="stat-card"><div class="stat-label">Reach</div><div class="stat-value">${analytics.totalReach !== null ? fmt(analytics.totalReach) : '-'}</div></div>
  </div>
  ${
    analytics.achievement?.viewsPct !== undefined
      ? `<div class="stat-grid" style="margin-top:12px"><div class="stat-card"><div class="stat-label">Pencapaian Target Views</div><div class="stat-value">${analytics.achievement.viewsPct}%</div></div></div>`
      : ''
  }

  <div class="section-title">Performa per Platform</div>
  ${platformBars || '<p style="font-size:13px;color:#777683">Belum ada data insight.</p>'}

  <div class="section-title">Daftar Creator</div>
  <table>
    <thead><tr><th>Nama</th><th>Platform</th><th>Views</th><th>Engagement</th></tr></thead>
    <tbody>${creatorRows || '<tr><td colspan="4" style="color:#777683">Belum ada creator.</td></tr>'}</tbody>
  </table>

  <div class="section-title">Insight &amp; Rekomendasi AI</div>
  <div class="insight-box">${campaign.aiInsight ? escape(campaign.aiInsight) : 'Insight belum di-generate.'}</div>

  <div class="footer">
    <span>AzeraKOL — Scale Brands. Amplify Impact</span>
    <span>@azerakol.id</span>
  </div>
</body>
</html>`
}
