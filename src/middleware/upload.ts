import multer from 'multer'

// Foto KOL & screenshot insight — hanya gambar
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

// Bukti transfer pembayaran — gambar atau PDF
export const uploadProof = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('Only image or PDF files are allowed'))
  },
})

const SPREADSHEET_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain', // beberapa OS mengirim .csv sebagai text/plain
]

// Import data historis — xlsx/csv
export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SPREADSHEET_MIME_TYPES.includes(file.mimetype) || /\.(xlsx|csv)$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('Only .xlsx or .csv files are allowed'))
  },
})
