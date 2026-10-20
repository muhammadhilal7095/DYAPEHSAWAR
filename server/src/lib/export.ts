import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { getSettings, type Settings } from './settings.js';
import { storedPath } from './files.js';
import { badRequest } from './http.js';

export interface Column {
  key: string;
  label: string;
  width?: number; // relative width
  align?: 'left' | 'right' | 'center';
  /** Excel cell format; Date values are written as real dates. */
  format?: 'date' | 'datetime' | 'number' | 'money';
}
export type Section =
  | { type: 'kv'; title?: string; items: [string, string | number | null | undefined][] }
  | { type: 'table'; title?: string; columns: Column[]; rows: Record<string, any>[]; footer?: Record<string, any> }
  | { type: 'list'; title: string; items: string[] }
  | { type: 'text'; title?: string; text: string }
  /** Photographs embedded in the PDF (PNG/JPEG only); ignored in CSV/Excel. */
  | { type: 'images'; title?: string; items: { fileId: string; caption: string }[] }
  /** Forces the following content onto a new PDF page. */
  | { type: 'pagebreak' };

export interface ReportDoc {
  title: string;
  filename: string;
  meta?: [string, string][];
  sections: Section[];
  landscape?: boolean;
}

// ── formatting ──
export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(d: Date | string | null | undefined, tz = 'Asia/Karachi') {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtMoney = (n: number | null | undefined) => (n === null || n === undefined ? '' : `PKR ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const humanize = (s: string | null | undefined) =>
  s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '';

const cellStr = (v: any) => (v === null || v === undefined ? '' : v instanceof Date ? fmtDate(v) : String(v));

// ── CSV ──
function csvEscape(v: any) {
  const s = cellStr(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function toCsv(doc: ReportDoc) {
  const lines: string[] = [];
  const tables = doc.sections.filter((s) => s.type === 'table') as Extract<Section, { type: 'table' }>[];
  const multi = doc.sections.length > 1;
  if (multi) {
    lines.push(csvEscape(doc.title));
    for (const [k, v] of doc.meta ?? []) lines.push([k, v].map(csvEscape).join(','));
    lines.push('');
  }
  for (const s of doc.sections) {
    if (s.type === 'images' || s.type === 'pagebreak') continue;
    if (s.type === 'kv') {
      if (s.title) lines.push(csvEscape(s.title));
      for (const [k, v] of s.items) lines.push([k, v].map(csvEscape).join(','));
      lines.push('');
    } else if (s.type === 'list') {
      lines.push(csvEscape(s.title));
      for (const i of s.items) lines.push(csvEscape(i));
      lines.push('');
    } else if (s.type === 'table') {
      if (multi && s.title) lines.push(csvEscape(s.title));
      lines.push(s.columns.map((c) => csvEscape(c.label)).join(','));
      for (const r of s.rows) lines.push(s.columns.map((c) => csvEscape(r[c.key])).join(','));
      if (s.footer) lines.push(s.columns.map((c) => csvEscape(s.footer![c.key])).join(','));
      if (multi) lines.push('');
    }
  }
  void tables;
  return '﻿' + lines.join('\r\n');
}

// ── XLSX ──
async function toXlsx(doc: ReportDoc, s: Settings) {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.orgName;
  wb.created = new Date();
  const kvs = doc.sections.filter((x) => x.type === 'kv' || x.type === 'list' || x.type === 'text');
  if (kvs.length || doc.meta?.length) {
    const ws = wb.addWorksheet('Summary');
    ws.addRow([s.orgName]).font = { bold: true, size: 14 };
    ws.addRow([doc.title]).font = { bold: true, size: 12 };
    for (const [k, v] of doc.meta ?? []) ws.addRow([k, v]);
    ws.addRow([]);
    for (const sec of kvs) {
      if (sec.type === 'kv') {
        if (sec.title) ws.addRow([sec.title]).font = { bold: true };
        for (const [k, v] of sec.items) ws.addRow([k, v ?? '']);
      } else if (sec.type === 'list') {
        ws.addRow([sec.title]).font = { bold: true };
        for (const i of sec.items) ws.addRow(['', i]);
      } else if (sec.type === 'text') {
        if (sec.title) ws.addRow([sec.title]).font = { bold: true };
        ws.addRow([sec.text]);
      }
      ws.addRow([]);
    }
    ws.getColumn(1).width = 36;
    ws.getColumn(2).width = 60;
  }
  let n = 0;
  for (const sec of doc.sections) {
    if (sec.type !== 'table') continue;
    n++;
    const name = (sec.title || `Data ${n}`).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(wb.getWorksheet(name) ? `${name.slice(0, 27)} ${n}` : name);
    ws.columns = sec.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(10, Math.min(60, (c.width ?? 1) * 14)) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + s.themeColor.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6) } };
    for (const r of sec.rows) ws.addRow(Object.fromEntries(sec.columns.map((c) => [c.key, r[c.key] instanceof Date ? r[c.key] : r[c.key] ?? ''])));
    for (const c of sec.columns) {
      const col = ws.getColumn(c.key);
      if (c.format === 'date') col.numFmt = 'dd-mmm-yyyy';
      else if (c.format === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
      else if (c.format === 'number') col.numFmt = '#,##0';
      else if (c.format === 'money') col.numFmt = '#,##0.00';
      if (c.align === 'right' || c.format === 'number' || c.format === 'money') col.alignment = { horizontal: 'right', vertical: 'top' };
      else col.alignment = { vertical: 'top', wrapText: (c.width ?? 1) >= 2 };
    }
    ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    if (sec.footer) ws.addRow(Object.fromEntries(sec.columns.map((c) => [c.key, sec.footer![c.key] ?? '']))).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sec.columns.length } };
  }
  if (!wb.worksheets.length) wb.addWorksheet('Report');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──
async function logoPath(s: Settings): Promise<string | null> {
  if (!s.logoFileId) return null;
  const f = await prisma.file.findUnique({ where: { id: s.logoFileId } });
  if (!f || !['image/png', 'image/jpeg'].includes(f.mimeType)) return null;
  const p = storedPath(f.storedName);
  return fs.existsSync(p) ? p : null;
}

/** Built-in PDF fonts are WinAnsi only: replace common symbols they cannot draw. */
function pdfSafe<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/→/g, '->').replace(/←/g, '<-').replace(/[✓✔]/g, 'Yes').replace(/×/g, 'x') as T;
  if (Array.isArray(v)) return v.map(pdfSafe) as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pdfSafe(x)])) as T;
  return v;
}

export async function toPdf(rawDoc: ReportDoc, s: Settings, generatedBy?: string): Promise<Buffer> {
  const doc = pdfSafe(rawDoc);
  const logo = await logoPath(s);
  const pdf = new PDFDocument({ size: 'A4', layout: doc.landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: doc.title, Author: s.orgName } });
  const chunks: Buffer[] = [];
  pdf.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(chunks))));
  const theme = /^#[0-9a-f]{6}$/i.test(s.themeColor) ? s.themeColor : '#0f5132';
  const left = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom - 20;

  // header
  let y = pdf.y;
  if (logo) {
    try {
      pdf.image(logo, left, y, { fit: [48, 48] });
    } catch {
      /* ignore bad logo */
    }
  }
  const hx = logo ? left + 58 : left;
  pdf.fillColor(theme).font('Helvetica-Bold').fontSize(15).text(s.orgName, hx, y, { width: width - (hx - left) });
  pdf.fillColor('#4b5563').font('Helvetica').fontSize(9).text(s.orgSubtitle, hx, pdf.y, { width: width - (hx - left) });
  pdf.moveDown(0.3);
  pdf.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(doc.title, hx, pdf.y, { width: width - (hx - left) });
  y = Math.max(pdf.y, y + 52) + 6;
  pdf.moveTo(left, y).lineTo(left + width, y).lineWidth(1.5).strokeColor(theme).stroke();
  pdf.y = y + 8;
  pdf.x = left;

  const meta: [string, string][] = [...(doc.meta ?? []), ['Generated', `${fmtDateTime(new Date(), s.timezone)}${generatedBy ? ` by ${generatedBy}` : ''}`]];
  pdf.font('Helvetica').fontSize(8.5).fillColor('#374151');
  for (const [k, v] of meta) {
    pdf.font('Helvetica-Bold').text(`${k}: `, left, pdf.y, { continued: true }).font('Helvetica').text(v || '—');
  }
  pdf.moveDown(0.6);

  const ensure = (h: number) => {
    if (pdf.y + h > bottom()) {
      pdf.addPage();
      pdf.y = pdf.page.margins.top;
    }
  };
  const sectionTitle = (t?: string) => {
    if (!t) return;
    ensure(30);
    pdf.moveDown(0.4);
    pdf.font('Helvetica-Bold').fontSize(10.5).fillColor(theme).text(t, left, pdf.y, { width });
    pdf.moveDown(0.2);
  };

  for (const sec of doc.sections) {
    if (sec.type === 'kv') {
      sectionTitle(sec.title);
      const labelW = Math.min(180, width * 0.35);
      for (const [k, v] of sec.items) {
        const val = cellStr(v) || '—';
        pdf.font('Helvetica').fontSize(8.5);
        const h = Math.max(pdf.heightOfString(val, { width: width - labelW - 8 }), pdf.heightOfString(k, { width: labelW })) + 5;
        ensure(h);
        const ry = pdf.y;
        pdf.rect(left, ry, width, h).fillColor('#f9fafb').fill();
        pdf.fillColor('#374151').font('Helvetica-Bold').text(k, left + 4, ry + 2.5, { width: labelW - 4 });
        pdf.fillColor('#111827').font('Helvetica').text(val, left + labelW + 4, ry + 2.5, { width: width - labelW - 8 });
        pdf.moveTo(left, ry + h).lineTo(left + width, ry + h).lineWidth(0.4).strokeColor('#e5e7eb').stroke();
        pdf.y = ry + h;
      }
    } else if (sec.type === 'list') {
      sectionTitle(sec.title);
      pdf.font('Helvetica').fontSize(8.5).fillColor('#111827');
      if (!sec.items.length) pdf.text('None', left, pdf.y);
      for (const i of sec.items) {
        ensure(14);
        pdf.text(`• ${i}`, left + 6, pdf.y, { width: width - 6 });
      }
    } else if (sec.type === 'text') {
      sectionTitle(sec.title);
      pdf.font('Helvetica').fontSize(8.5).fillColor('#111827').text(sec.text || '—', left, pdf.y, { width });
    } else if (sec.type === 'pagebreak') {
      pdf.addPage();
      pdf.y = pdf.page.margins.top;
    } else if (sec.type === 'images') {
      sectionTitle(sec.title);
      const files = await prisma.file.findMany({ where: { id: { in: sec.items.map((i) => i.fileId) }, deletedAt: null } });
      const byId = new Map(files.map((f) => [f.id, f]));
      const perRow = 2;
      const gap = 10;
      const cellW = (width - gap * (perRow - 1)) / perRow;
      const imgH = cellW * 0.66;
      const skipped: string[] = [];
      let col = 0;
      let rowY = pdf.y;
      for (const it of sec.items) {
        const f = byId.get(it.fileId);
        const p = f ? storedPath(f.storedName) : null;
        if (!f || !p || !['image/png', 'image/jpeg'].includes(f.mimeType) || !fs.existsSync(p)) {
          if (f) skipped.push(`${f.originalName} (${f.mimeType === 'image/webp' ? 'WebP cannot be embedded in PDF' : 'unavailable'})`);
          continue;
        }
        if (col === 0) {
          if (rowY + imgH + 30 > bottom()) {
            pdf.addPage();
            rowY = pdf.page.margins.top;
          }
        }
        const x = left + col * (cellW + gap);
        pdf.rect(x, rowY, cellW, imgH).fillColor('#f3f4f6').fill();
        try {
          pdf.image(p, x, rowY, { fit: [cellW, imgH], align: 'center', valign: 'center' });
        } catch {
          skipped.push(`${f.originalName} (could not be read)`);
        }
        pdf.font('Helvetica').fontSize(7.5).fillColor('#374151').text(it.caption || f.originalName, x, rowY + imgH + 3, { width: cellW, height: 22, ellipsis: true });
        col++;
        if (col === perRow) {
          col = 0;
          rowY += imgH + 30;
        }
      }
      pdf.y = col === 0 ? rowY : rowY + imgH + 30;
      pdf.x = left;
      if (!sec.items.length) pdf.font('Helvetica-Oblique').fontSize(8.5).fillColor('#6b7280').text('No photographs selected.', left, pdf.y);
      if (skipped.length) pdf.font('Helvetica-Oblique').fontSize(7.5).fillColor('#6b7280').text(`Not embedded: ${skipped.join('; ')}`, left, pdf.y, { width });
    } else {
      sectionTitle(sec.title);
      const total = sec.columns.reduce((a, c) => a + (c.width ?? 1), 0);
      const widths = sec.columns.map((c) => ((c.width ?? 1) / total) * width);
      const fontSize = sec.columns.length > 12 ? 6.5 : sec.columns.length > 8 ? 7.5 : 8.5;
      const drawRow = (vals: string[], header: boolean, shade: boolean, bold = false) => {
        pdf.font(header || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
        const h = Math.max(...vals.map((v, i) => pdf.heightOfString(v || ' ', { width: widths[i] - 6 }))) + 6;
        if (pdf.y + h > bottom()) {
          pdf.addPage();
          pdf.y = pdf.page.margins.top;
          if (!header) drawRow(sec.columns.map((c) => c.label), true, false);
        }
        const ry = pdf.y;
        if (header) pdf.rect(left, ry, width, h).fillColor(theme).fill();
        else if (shade) pdf.rect(left, ry, width, h).fillColor('#f3f4f6').fill();
        let x = left;
        vals.forEach((v, i) => {
          pdf.fillColor(header ? '#ffffff' : '#111827').font(header || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
            .text(v, x + 3, ry + 3, { width: widths[i] - 6, align: sec.columns[i].align ?? 'left' });
          x += widths[i];
        });
        pdf.moveTo(left, ry + h).lineTo(left + width, ry + h).lineWidth(0.4).strokeColor('#d1d5db').stroke();
        pdf.y = ry + h;
      };
      ensure(40);
      drawRow(sec.columns.map((c) => c.label), true, false);
      if (!sec.rows.length) {
        pdf.font('Helvetica-Oblique').fontSize(8.5).fillColor('#6b7280').text('No records for the selected filters.', left + 4, pdf.y + 4);
        pdf.moveDown(0.5);
      }
      const cell = (c: Column, v: any) => (v instanceof Date && c.format === 'datetime' ? fmtDateTime(v, s.timezone) : typeof v === 'number' && c.format === 'money' ? fmtMoney(v) : typeof v === 'number' && c.format === 'number' ? v.toLocaleString('en-US') : cellStr(v));
      sec.rows.forEach((r, i) => drawRow(sec.columns.map((c) => cell(c, r[c.key])), false, i % 2 === 1));
      if (sec.footer) drawRow(sec.columns.map((c) => cellStr(sec.footer![c.key])), false, false, true);
      pdf.moveDown(0.5);
    }
  }

  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    // write the footer inside the bottom margin without triggering an automatic page break
    const bottomMargin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    const fy = pdf.page.height - bottomMargin + 8;
    pdf.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
    pdf.text(`${s.orgName} — ${doc.title}`, left, fy, { width: width / 2, lineBreak: false });
    pdf.text(`Page ${i + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
    pdf.page.margins.bottom = bottomMargin;
  }
  pdf.end();
  return done;
}

export async function sendExport(res: Response, format: string, doc: ReportDoc, generatedBy?: string) {
  const s = await getSettings();
  const base = doc.filename.replace(/[^\w.-]/g, '_');
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(doc));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(await toXlsx(doc, s));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.send(await toPdf(doc, s, generatedBy));
  }
  throw badRequest('Unsupported export format. Use csv, xlsx or pdf.');
}
