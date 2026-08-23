import multer from 'multer';
import { ApiError } from '../utils/ApiError';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      ApiError.badRequest(
        'Tipo de archivo no permitido. Solo se aceptan archivos .xlsx y .xls',
        'INVALID_FILE_TYPE'
      )
    );
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: FILE_SIZE_LIMIT,
    files: 1,
  },
});

export const uploadSingle = (fieldName: string) => upload.single(fieldName);