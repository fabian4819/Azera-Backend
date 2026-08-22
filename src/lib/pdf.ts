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

export function renderHtmlToPdf(html: string): Promise<Buffer> {
  const job = queue.then(async () => {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      await page.setContent(html, { waitUntil: 'load' })
      const pdf = await page.pdf({ format: 'A4', printBackground: true })
      return Buffer.from(pdf)
    } finally {
      await page.close()
    }
  })
  queue = job.catch(() => undefined)
  return job
}
