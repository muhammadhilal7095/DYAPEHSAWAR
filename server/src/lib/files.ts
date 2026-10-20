import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import exifr from 'exifr';
import { config } from '../config.js';
import { badRequest } from './http.js';
import { getSettings } from './settings.js';

export const HARD_UPLOAD_LIMIT = 50 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_UPLOAD_LIMIT, files: 20 },
});

type Detected = { mime: string; ext: string; kind: 'PHOTO' | 'DOCUMENT' };

/** Identifies the file by its content (magic bytes), never by the client-supplied MIME type. */
export function sniff(buf: Buffer, originalName: string): Detected | null {
  const ext = path.extname(originalName).toLowerCase();
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg', kind: 'PHOTO' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png', kind: 'PHOTO' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp', kind: 'PHOTO' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: '.pdf', kind: 'DOCUMENT' };
  // Office Open XML (zip container) — only accepted with a matching extension
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (ext === '.docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext, kind: 'DOCUMENT' };
    if (ext === '.xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext, kind: 'DOCUMENT' };
    if (ext === '.pptx') return { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext, kind: 'DOCUMENT' };
  }
  return null;
}

export const PHOTO_TYPES = 'JPG, JPEG, PNG, WebP';
export const DOC_TYPES = 'PDF, DOCX, XLSX, PPTX, JPG, PNG, WebP';

export interface StoredFile {
  storedName: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: 'PHOTO' | 'DOCUMENT';
  exifTakenAt: Date | null;
  exifLatitude: number | null;
  exifLongitude: number | null;
}

/** Validates and writes an uploaded file to private storage. Returns metadata for the File row. */
export async function storeUpload(f: Express.Multer.File, opts: { photosOnly?: boolean; allowPdfImages?: boolean } = {}): Promise<StoredFile> {
  const s = await getSettings();
  const maxBytes = s.maxUploadMb * 1024 * 1024;
  const name = path.basename(f.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 180) || 'file';
  if (f.size > maxBytes) throw badRequest(`"${name}" exceeds the maximum upload size of ${s.maxUploadMb} MB.`);
  const det = sniff(f.buffer, name);
  if (!det) throw badRequest(`"${name}" is not an allowed file type. Allowed: ${opts.photosOnly ? PHOTO_TYPES : DOC_TYPES}.`);
  if (opts.photosOnly && det.kind !== 'PHOTO') throw badRequest(`"${name}" must be an image (${PHOTO_TYPES}).`);
  if (opts.allowPdfImages && !['image/jpeg', 'image/png', 'application/pdf'].includes(det.mime)) {
    throw badRequest(`"${name}" must be a PDF, JPG, JPEG or PNG file.`);
  }

  let exifTakenAt: Date | null = null;
  let exifLatitude: number | null = null;
  let exifLongitude: number | null = null;
  if (det.kind === 'PHOTO' && det.mime !== 'image/png') {
    try {
      const ex = await exifr.parse(f.buffer, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude'] });
      if (ex) {
        const dt = ex.DateTimeOriginal ?? ex.CreateDate;
        if (dt instanceof Date && !isNaN(dt.getTime())) exifTakenAt = dt;
        if (typeof ex.latitude === 'number' && typeof ex.longitude === 'number' && Math.abs(ex.latitude) <= 90 && Math.abs(ex.longitude) <= 180) {
          exifLatitude = ex.latitude;
          exifLongitude = ex.longitude;
        }
      }
    } catch {
      /* no EXIF */
    }
  }

  await fs.mkdir(config.uploadDir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${det.ext}`;
  await fs.writeFile(path.join(config.uploadDir, storedName), f.buffer, { mode: 0o600 });
  return {
    storedName,
    originalName: name,
    mimeType: det.mime,
    size: f.size,
    sha256: crypto.createHash('sha256').update(f.buffer).digest('hex'),
    kind: det.kind,
    exifTakenAt,
    exifLatitude,
    exifLongitude,
  };
}

export async function removeStored(storedName: string) {
  await fs.rm(path.join(config.uploadDir, path.basename(storedName)), { force: true });
}

/** Stores a server-generated file (e.g. a report PDF) in private storage. */
export async function storeBuffer(buf: Buffer, originalName: string, mimeType: string, ext: string) {
  await fs.mkdir(config.uploadDir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${ext}`;
  await fs.writeFile(path.join(config.uploadDir, storedName), buf, { mode: 0o600 });
  return { storedName, originalName, mimeType, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

export function storedPath(storedName: string) {
  return path.join(config.uploadDir, path.basename(storedName));
}

export const fileSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  kind: true,
  category: true,
  caption: true,
  description: true,
  featured: true,
  takenAt: true,
  latitude: true,
  longitude: true,
  locationSource: true,
  exifTakenAt: true,
  exifLatitude: true,
  exifLongitude: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;
