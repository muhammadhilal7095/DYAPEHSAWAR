import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, can } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound, parse, zOptStr } from '../lib/http.js';
import { fileSelect, removeStored, storedPath, storeUpload, upload, type StoredFile } from '../lib/files.js';
import { fileTarget, targetForFile } from '../lib/fileTargets.js';
import { getSettings } from '../lib/settings.js';

export const filesRouter = Router();

const metaSchema = z.object({
  category: z.string().trim().max(40).default('GENERAL'),
  caption: zOptStr(300),
  description: zOptStr(2000),
  takenAt: z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/), z.literal('')]).optional().nullable(),
  latitude: z.union([z.coerce.number().min(-90).max(90), z.literal('')]).optional().nullable(),
  longitude: z.union([z.coerce.number().min(-180).max(180), z.literal('')]).optional().nullable(),
  locationSource: z.enum(['DEVICE', 'MANUAL', 'NONE']).optional(),
});

function parseTakenAt(v: any): Date | null {
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return isNaN(d.getTime()) ? null : d;
}

/** Upload one or more files to an entity: POST /api/files/:target/:id (multipart field "files"). */
filesRouter.post('/:target/:id', requireAuth, upload.array('files', 20), async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Select at least one file to upload.');
  const meta = parse(metaSchema, req.body);

  // Organisation logo (settings)
  if (String(req.params.target) === 'logo') {
    if (!can(req.user, 'admin.settings')) throw forbidden();
    const st = await storeUpload(files[0], { photosOnly: true });
    if (!['image/png', 'image/jpeg'].includes(st.mimeType)) {
      await removeStored(st.storedName);
      throw badRequest('The logo must be a PNG or JPEG image.');
    }
    const row = await prisma.file.create({ data: { ...st, category: 'LOGO', uploadedById: req.user!.id }, select: fileSelect });
    await audit(prisma, req, { action: 'LOGO_UPLOADED', entityType: 'File', entityId: row.id, entityRef: row.originalName });
    return res.status(201).json([row]);
  }

  const target = fileTarget(String(req.params.target));
  if (!target) throw notFound('Unknown upload target.');
  const rule = target.categories[meta.category];
  if (!rule) throw badRequest(`Invalid category "${meta.category}".`);
  const allowed = await target.canUpload(req.user!, String(req.params.id), meta.category);
  if (!allowed) throw forbidden('You cannot upload files to this record in its current state.');

  const stored: StoredFile[] = [];
  try {
    for (const f of files) stored.push(await storeUpload(f, { photosOnly: rule === 'photo', allowPdfImages: rule === 'pdfimage' }));
  } catch (e) {
    for (const s of stored) await removeStored(s.storedName);
    throw e;
  }

  const manualLat = meta.latitude === '' || meta.latitude == null ? null : Number(meta.latitude);
  const manualLng = meta.longitude === '' || meta.longitude == null ? null : Number(meta.longitude);
  const takenAt = parseTakenAt(meta.takenAt);

  const rows = await prisma.$transaction(async (tx) => {
    const out: any[] = [];
    for (const st of stored) {
      // Location precedence: embedded EXIF GPS > device location supplied at upload > manual entry.
      let latitude: number | null = null;
      let longitude: number | null = null;
      let locationSource = 'NONE';
      if (st.exifLatitude != null && st.exifLongitude != null) {
        latitude = st.exifLatitude; longitude = st.exifLongitude; locationSource = 'EXIF';
      } else if (manualLat != null && manualLng != null) {
        latitude = manualLat; longitude = manualLng; locationSource = meta.locationSource === 'DEVICE' ? 'DEVICE' : 'MANUAL';
      }
      const row = await tx.file.create({
        data: {
          storedName: st.storedName,
          originalName: st.originalName,
          mimeType: st.mimeType,
          size: st.size,
          sha256: st.sha256,
          kind: st.kind,
          exifTakenAt: st.exifTakenAt,
          exifLatitude: st.exifLatitude,
          exifLongitude: st.exifLongitude,
          category: meta.category,
          caption: meta.caption,
          description: meta.description,
          takenAt: takenAt ?? st.exifTakenAt,
          latitude,
          longitude,
          locationSource,
          uploadedById: req.user!.id,
          [target.fk]: String(req.params.id),
          ...(allowed.extra ?? {}),
        },
        select: fileSelect,
      });
      out.push(row);
    }
    await audit(tx, req, {
      action: 'FILE_UPLOADED',
      module: target.module,
      entityType: target.entityType,
      entityId: String(req.params.id),
      entityRef: allowed.ref,
      after: out.map((r) => ({ id: r.id, name: r.originalName, category: r.category, size: r.size, locationSource: r.locationSource })),
    });
    return out;
  }).catch(async (e) => {
    for (const s of stored) await removeStored(s.storedName);
    throw e;
  });
  res.status(201).json(rows);
});

async function authorizeFile(req: any, id: string) {
  const f = await prisma.file.findUnique({ where: { id } });
  if (!f || f.deletedAt) throw notFound('File not found.');
  if (f.category === 'LOGO') return f;
  const t = targetForFile(f);
  if (!t) throw notFound('File not found.');
  if (!(await t.target.canView(req.user, t.id))) throw forbidden('You do not have access to this file.');
  return f;
}

/** Streams a file. Inline for images/PDF preview; ?download=1 forces download. */
filesRouter.get('/:id', async (req, res) => {
  const f = await prisma.file.findUnique({ where: { id: String(req.params.id) } });
  // the organisation logo is public (shown on the login page)
  const s = await getSettings();
  if (!(f && f.category === 'LOGO' && s.logoFileId === f.id)) {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    await authorizeFile(req, String(req.params.id));
  }
  const p = storedPath(f!.storedName);
  if (!fs.existsSync(p)) throw notFound('The stored file is missing.');
  res.setHeader('Content-Type', f!.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  const disp = req.query.download === '1' || !/^(image\/|application\/pdf)/.test(f!.mimeType) ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(f!.originalName)}"`);
  fs.createReadStream(p).pipe(res);
});

filesRouter.patch('/:id', requireAuth, async (req, res) => {
  const f = await authorizeFile(req, String(req.params.id));
  const t = targetForFile(f)!;
  if (!(await t.target.canDelete(req.user!, t.id, f))) throw forbidden('You cannot edit this file.');
  const b = parse(z.object({ caption: zOptStr(300), description: zOptStr(2000), takenAt: z.string().optional().nullable(), category: z.string().max(40).optional() }), req.body);
  if (b.category && t.target.categories[b.category] !== t.target.categories[f.category]) throw badRequest('Invalid category for this file.');
  const row = await prisma.file.update({
    where: { id: f.id },
    data: { caption: 'caption' in (req.body ?? {}) ? b.caption : undefined, description: 'description' in (req.body ?? {}) ? b.description : undefined, takenAt: b.takenAt !== undefined ? parseTakenAt(b.takenAt) : undefined, category: b.category },
    select: fileSelect,
  });
  await audit(prisma, req, { action: 'FILE_UPDATED', module: t.target.module, entityType: t.target.entityType, entityId: t.id, before: { caption: f.caption, takenAt: f.takenAt, category: f.category }, after: b });
  res.json(row);
});

/** Soft delete — the stored file is kept for the audit trail. */
filesRouter.delete('/:id', requireAuth, async (req, res) => {
  const f = await authorizeFile(req, String(req.params.id));
  const t = targetForFile(f)!;
  if (!(await t.target.canDelete(req.user!, t.id, f))) throw forbidden('You cannot remove this file.');
  await prisma.file.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
  await audit(prisma, req, { action: 'FILE_REMOVED', module: t.target.module, entityType: t.target.entityType, entityId: t.id, before: { id: f.id, name: f.originalName, category: f.category } });
  res.json({ ok: true });
});
