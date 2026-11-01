import { BadRequestException } from '@nestjs/common';
import mammoth from 'mammoth';
import type { AiDocument } from '../ai/ai-provider';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type FileKind = 'xlsx' | 'csv' | 'docx' | 'pdf' | 'text';

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Decide what a file is from its extension AND its content, so a renamed executable or a
 * mislabeled upload is rejected rather than parsed.
 */
export function classifyFile(file: UploadedFile): FileKind {
  const name = file.originalname.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const head = file.buffer.subarray(0, 5);
  const isZip = head.subarray(0, 4).equals(ZIP);
  if (ext === 'xlsx') {
    if (!isZip) throw new BadRequestException('This .xlsx file is not a valid Excel workbook.');
    return 'xlsx';
  }
  if (ext === 'docx') {
    if (!isZip) throw new BadRequestException('This .docx file is not a valid Word document.');
    return 'docx';
  }
  if (ext === 'pdf') {
    if (head.toString('latin1') !== '%PDF-') throw new BadRequestException('This .pdf file is not a valid PDF.');
    return 'pdf';
  }
  if (ext === 'csv' || ext === 'txt' || ext === 'md') {
    if (file.buffer.subarray(0, 4096).includes(0)) throw new BadRequestException('This file is not plain text.');
    return ext === 'csv' ? 'csv' : 'text';
  }
  if (ext === 'xls' || ext === 'doc') {
    throw new BadRequestException(`Old .${ext} files are not supported. Save the file as .${ext}x and upload it again.`);
  }
  throw new BadRequestException('Upload an Excel (.xlsx), CSV, Word (.docx), PDF or text file.');
}

/** Turn a document into material for the AI architect. */
export async function toAiDocument(file: UploadedFile, kind: FileKind): Promise<AiDocument> {
  const name = file.originalname.slice(0, 200);
  if (kind === 'pdf') return { name, kind: 'pdf', base64: file.buffer.toString('base64') };
  if (kind === 'docx') {
    try {
      // Raw text keeps numbering and option lists readable without carrying any markup.
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      if (!value.trim()) throw new Error('empty');
      return { name, kind: 'text', text: value };
    } catch {
      throw new BadRequestException('The Word document could not be read, or it has no text.');
    }
  }
  return { name, kind: 'text', text: file.buffer.toString('utf8').replace(/^\uFEFF/, '') };
}
