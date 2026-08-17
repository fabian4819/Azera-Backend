function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  defaultTenantSlug: process.env.DEFAULT_TENANT_SLUG || 'azerakol',

  get mongodbUri() {
    return required('MONGODB_URI')
  },
  get jwtSecret() {
    return required('JWT_SECRET')
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  waNumber: process.env.WA_NUMBER || '',

  ai: {
    textProvider: process.env.AI_TEXT_PROVIDER || 'deepseek',
    visionProvider: process.env.AI_VISION_PROVIDER || 'gemini',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  },

  isProd: process.env.NODE_ENV === 'production',
}
