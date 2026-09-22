import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { ApiError } from '../utils/ApiError';

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const IMAGE_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB

const imageFileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      ApiError.badRequest(
        'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG, WebP o GIF',
        'INVALID_IMAGE_TYPE'
      )
    );
  }
};

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'products'));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuid()}${ext}`);
  },
});

export const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: IMAGE_SIZE_LIMIT,
    files: 1,
  },
});

export const uploadImageSingle = (fieldName: string) =>
  imageUpload.single(fieldName);
