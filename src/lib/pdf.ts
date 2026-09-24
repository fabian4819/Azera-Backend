import puppeteer, { Browser } from 'puppeteer'

/**
 * Render HTML → PDF buffer via headless Chromium. Renders are queued
 * one-at-a-time — VPS RAM budget only accounts for a single Puppeteer
 * spike at once (lihat docs/plan/01-architecture.md).
 */

let browserPromise: Promise<Browser> | null = null
let queue: Promise<unknown> = Promise.resolve()

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
  }
  return browserPromise
}

export interface PdfOptions {
  /** HTML header/footer berulang tiap halaman (Chromium template: class pageNumber/totalPages tersedia) */
  headerTemplate?: string
  footerTemplate?: string
  margin?: { top?: string; right?: string; bottom?: string; left?: string }
}

export function renderHtmlToPdf(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const job = queue.then(async () => {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      // Dokumen berisi isian user (sudah di-escape) — JS tetap dimatikan sebagai lapisan kedua
      await page.setJavaScriptEnabled(false)
      await page.setContent(html, { waitUntil: 'load' })
      const withHeaderFooter = !!(options.headerTemplate || options.footerTemplate)
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: withHeaderFooter,
        headerTemplate: options.headerTemplate ?? '<span></span>',
        footerTemplate: options.footerTemplate ?? '<span></span>',
        margin: options.margin,
      })
      return Buffer.from(pdf)
    } finally {
      await page.close()
    }
  })
  queue = job.catch(() => undefined)
  return job
}
