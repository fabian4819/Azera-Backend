import { Request, Response, NextFunction } from 'express'
import { connectDB } from '../../db/connect'
import ExtensionToken, { hashToken } from './extensionToken.model'

export interface ExtRequest extends Request {
  ext?: {
    tenantId: string
    userId: string
    tokenId: string
  }
}

/**
 * Auth untuk route yang dipanggil ekstensi. Bukan JWT — pakai kode sambungan
 * jangka panjang di header `X-Azera-Ext-Token`. Aman tanpa proteksi CSRF karena
 * bukan cookie-based (browser tidak auto-attach header ini).
 */
export async function requireExtensionToken(req: ExtRequest, res: Response, next: NextFunction) {
  const raw = req.header('X-Azera-Ext-Token')
  if (!raw || !raw.startsWith('AZK1-')) {
    res.status(401).json({ message: 'Kode sambungan ekstensi tidak ada atau formatnya salah' })
    return
  }
  try {
    await connectDB()
    const token = await ExtensionToken.findOne({ tokenHash: hashToken(raw.trim()) })
    if (!token || token.revokedAt) {
      res.status(401).json({ message: 'Kode sambungan tidak valid atau sudah dicabut' })
      return
    }
    req.ext = {
      tenantId: String(token.tenantId),
      userId: String(token.createdByUserId),
      tokenId: String(token._id),
    }
    // fire-and-forget, throttle ~1x/menit biar tidak nulis tiap request
    const stale = !token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000
    if (stale) {
      token.lastUsedAt = new Date()
      token.lastUsedUa = req.header('User-Agent')?.slice(0, 200)
      token.save().catch(() => {})
    }
    next()
  } catch {
    res.status(500).json({ message: 'Server error' })
  }
}
