import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { UserRole } from '../modules/users/user.model'

interface StaffTokenPayload {
  sub: string
  tenantId: string
  role: UserRole
  type: 'staff'
}

interface CreatorTokenPayload {
  sub: string
  tenantId: string
  type: 'creator'
}

type TokenPayload = StaffTokenPayload | CreatorTokenPayload

export interface AuthContext {
  userId: string
  tenantId: string
  role: UserRole | 'creator'
}

export interface AuthRequest extends Request {
  auth?: AuthContext
  /** @deprecated gunakan req.auth.userId — dipertahankan untuk kompatibilitas routes landing page lama */
  adminId?: string
}

function signToken(payload: TokenPayload, expiresIn: string): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn } as jwt.SignOptions)
}

export function signStaffToken(userId: string, tenantId: string, role: UserRole): string {
  return signToken({ sub: userId, tenantId, role, type: 'staff' }, '7d')
}

export function signCreatorToken(creatorId: string, tenantId: string): string {
  return signToken({ sub: creatorId, tenantId, type: 'creator' }, '30d')
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthorized' })
    return
  }
  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload
    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.type === 'creator' ? 'creator' : payload.role,
    }
    req.adminId = payload.sub
    next()
  } catch {
    res.status(401).json({ message: 'Invalid token' })
  }
}

export function requireRole(...roles: Array<UserRole | 'creator'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ message: 'Forbidden' })
      return
    }
    next()
  }
}
