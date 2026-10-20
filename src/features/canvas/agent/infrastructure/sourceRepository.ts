import { strFromU8, unzipSync, inflateSync } from 'fflate';
import {
  sourceReferenceSchema,
  type SourceKind,
  type SourceReferenceV1,
  type SourceSegmentV1,
} from '../domain/sourceReference';

export const SOURCE_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const SOURCE_MAX_CHARACTERS = 500_000;
export const SOURCE_READ_MAX_CHUNK = 12_000;

export interface SourceImportInput {
  projectId: string;
  name: string;
  kind: SourceKind;
  text?: string;
  buffer?: ArrayBuffer | Uint8Array;
  mimeType?: string;
  nodeId?: string;
  assetId?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceRecord {
  reference: SourceReferenceV1;
  fullText: string;
  rawBytes?: Uint8Array;
}

export interface SourceReadParams {
  sourceId: string;
  cursor?: number;
  limitCharacters?: number;
  segmentId?: string;
}

export interface SourceReadResult {
  sourceId: string;
  name: string;
  kind: SourceKind;
  contentHash: string;
  totalCharacters: number;
  cursor: number;
  textChunk: string;
  nextCursor: number | null;
  isEof: boolean;
  requiresOcr: boolean;
  ocrReason?: string;
  activeSegment?: SourceSegmentV1;
}

export interface SourceInspectResult {
  sourceId: string;
  projectId: string;
  name: string;
  kind: SourceKind;
  mimeType: string;
  contentHash: string;
  characterCount: number;
  pageCount?: number;
  segments: SourceSegmentV1[];
  requiresOcr: boolean;
  ocrReason?: string;
  metadata?: Record<string, unknown>;
}

export async function computeSha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }
  const { createHash } = await import('node:crypto');
  const hex = createHash('sha256').update(bytes).digest('hex');
  return `sha256:${hex}`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeText(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(new TextDecoder('utf-16le').decode(bytes));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripBom(new TextDecoder('utf-16be').decode(bytes));
  }
  return stripBom(new TextDecoder('utf-8').decode(bytes));
}

function extractSegmentsFromText(text: string): SourceSegmentV1[] {
  const lines = text.split('\n');
  const segments: SourceSegmentV1[] = [];
  let currentOffset = 0;
  let segmentIndex = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.match(/^(?:第[0-9一二三四五六七八九十]+[集幕场镜]|Scene\s*\d+|Shot\s*\d+)/i)) {
      const label = trimmed.replace(/^#+\s*/, '').slice(0, 48);
      segments.push({
        id: `seg-${segmentIndex++}`,
        label,
        charStart: currentOffset,
        charEnd: currentOffset + line.length,
      });
    }
    currentOffset += line.length + 1; // +1 for '\n'
  }

  // If no heading segments found, create standard paragraph segments if text is long enough
  if (segments.length === 0 && text.length > 500) {
    const paragraphs = text.split(/\n\s*\n/);
    let offset = 0;
    let pIdx = 1;
    for (const p of paragraphs) {
      if (p.trim().length > 0) {
        segments.push({
          id: `seg-${pIdx++}`,
          label: `段落 ${pIdx - 1}`,
          charStart: offset,
          charEnd: offset + p.length,
        });
      }
      offset += p.length + 2;
    }
  }

  return segments;
}

export function extractDocxText(buffer: ArrayBuffer | Uint8Array): {
  text: string;
  segments: SourceSegmentV1[];
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (err) {
    throw new Error(`无效的 DOCX 文件结构：解包失败 (${(err as Error).message})`);
  }

  const docXmlBytes = unzipped['word/document.xml'];
  if (!docXmlBytes) {
    throw new Error('无效的 DOCX 文件：未找到 word/document.xml 正文结构');
  }

  const xml = strFromU8(docXmlBytes);
  const pRegex = /<w:p(?:\s[^>]*)?>(.*?)<\/w:p>/gs;
  const tRegex = /<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs;

  const paragraphs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const pContent = match[1];
    let pText = '';
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      pText += tMatch[1];
    }
    const trimmed = pText.trim();
    if (trimmed) {
      paragraphs.push(trimmed);
    }
  }

  const fullText = paragraphs.join('\n\n');
  const segments = extractSegmentsFromText(fullText);
  return { text: fullText, segments };
}

export function parseDelimitedTable(
  raw: string,
  delimiter = ','
): { markdown: string; rowCount: number; colCount: number; segments: SourceSegmentV1[] } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    return { markdown: '', rowCount: 0, colCount: 0, segments: [] };
  }

  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizedRows = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push('');
    return copy;
  });

  const header = normalizedRows[0];
  const separator = header.map(() => '---');
  const body = normalizedRows.slice(1);
  const mdLines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  const markdown = mdLines.join('\n');
  const segments: SourceSegmentV1[] = [
    { id: 'seg-header', label: '表头', charStart: 0, charEnd: mdLines[0].length },
    { id: 'seg-body', label: `数据 (${body.length} 行)`, charStart: mdLines[0].length + 1, charEnd: markdown.length },
  ];

  return {
    markdown,
    rowCount: rows.length,
    colCount,
    segments,
  };
}

export async function parseXlsxTable(
  buffer: ArrayBuffer | Uint8Array
): Promise<{ markdown: string; rowCount: number; colCount: number; segments: SourceSegmentV1[] }> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let readXlsxFile: any;
  try {
    const mod = await import('read-excel-file/universal');
    readXlsxFile = mod.default || mod;
  } catch {
    const mod = await import('read-excel-file/browser');
    readXlsxFile = mod.default || mod;
  }

  const rows = (await readXlsxFile(bytes.buffer)) as unknown[][];
  if (!rows || !rows.length) {
    return { markdown: '', rowCount: 0, colCount: 0, segments: [] };
  }

  const stringRows = rows.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
  );
  const colCount = Math.max(...stringRows.map((r) => r.length));
  const header = [...stringRows[0]];
  while (header.length < colCount) header.push('');
  const separator = header.map(() => '---');
  const body = stringRows.slice(1).map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push('');
    return copy;
  });

  const mdLines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  const markdown = mdLines.join('\n');
  const segments: SourceSegmentV1[] = [
    { id: 'seg-header', label: '表头', charStart: 0, charEnd: mdLines[0].length },
    { id: 'seg-body', label: `表格数据 (${body.length} 行)`, charStart: mdLines[0].length + 1, charEnd: markdown.length },
  ];

  return {
    markdown,
    rowCount: rows.length,
    colCount,
    segments,
  };
}

export function extractPdfText(buffer: ArrayBuffer | Uint8Array): {
  text: string;
  pageCount: number;
  segments: SourceSegmentV1[];
  requiresOcr: boolean;
  ocrReason?: string;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const header = strFromU8(bytes.subarray(0, 8));
  if (!header.startsWith('%PDF-')) {
    throw new Error('无效的 PDF 文件：缺少 %PDF- 文件标识');
  }

  const latin1Str = strFromU8(bytes);
  const pageMatches = latin1Str.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 1;

  // Search for stream ... endstream blocks
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  const extractedPieces: string[] = [];
  let streamMatch: RegExpExecArray | null;

  while ((streamMatch = streamRegex.exec(latin1Str)) !== null) {
    const rawStream = streamMatch[1];
    let decompressed: string = rawStream;

    // Check if preceded by /Filter /FlateDecode
    const streamStartPos = streamMatch.index;
    const streamHeaderArea = latin1Str.slice(Math.max(0, streamStartPos - 200), streamStartPos);
    if (streamHeaderArea.includes('/FlateDecode')) {
      try {
        const streamBytes = new Uint8Array(rawStream.length);
        for (let i = 0; i < rawStream.length; i++) {
          streamBytes[i] = rawStream.charCodeAt(i) & 0xff;
        }
        const inflated = inflateSync(streamBytes);
        decompressed = strFromU8(inflated);
      } catch {
        // Fallback to raw stream if decompression fails
        decompressed = rawStream;
      }
    }

    // Extract text operators: (...) Tj or [...] TJ
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = tjRegex.exec(decompressed)) !== null) {
      const val = textMatch[1].trim();
      if (val) extractedPieces.push(val);
    }

    const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((textMatch = tjArrayRegex.exec(decompressed)) !== null) {
      const arrayContent = textMatch[1];
      const innerRegex = /\(([^)]*)\)/g;
      let innerMatch: RegExpExecArray | null;
      let combined = '';
      while ((innerMatch = innerRegex.exec(arrayContent)) !== null) {
        combined += innerMatch[1];
      }
      if (combined.trim()) {
        extractedPieces.push(combined.trim());
      }
    }
  }

  const fullText = extractedPieces.join('\n');
  if (fullText.trim().length === 0) {
    return {
      text: '',
      pageCount,
      segments: [],
      requiresOcr: true,
      ocrReason: 'PDF 文件为纯扫描件或无可选文本层，需要 OCR 识别服务，无法直接提取纯文本。',
    };
  }

  const segments = extractSegmentsFromText(fullText);
  return {
    text: fullText,
    pageCount,
    segments,
    requiresOcr: false,
  };
}

class SourceRepository {
  private sources = new Map<string, SourceRecord>();

  async importSource(input: SourceImportInput): Promise<SourceReferenceV1> {
    if (!input.projectId || !input.projectId.trim()) {
      throw new Error('导入来源必须包含有效的 projectId');
    }
    if (!input.name || !input.name.trim()) {
      throw new Error('导入来源必须包含有效的名称');
    }

    const now = Date.now();
    let text = '';
    let segments: SourceSegmentV1[] = [];
    let pageCount: number | undefined;
    let requiresOcr = false;
    let ocrReason: string | undefined;
    let mimeType = input.mimeType || 'text/plain';
    let rawBytes: Uint8Array | undefined;

    if (input.buffer) {
      const bytes = input.buffer instanceof Uint8Array ? input.buffer : new Uint8Array(input.buffer);
      rawBytes = bytes;
      if (bytes.length > SOURCE_MAX_FILE_BYTES) {
        throw new Error(`文件大小超出限制：当前为 ${(bytes.length / (1024 * 1024)).toFixed(1)}MB，上限为 20MB`);
      }

      if (input.kind === 'docx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const docxResult = extractDocxText(bytes);
        text = docxResult.text;
        segments = docxResult.segments;
      } else if (input.kind === 'pdf') {
        mimeType = 'application/pdf';
        const pdfResult = extractPdfText(bytes);
        text = pdfResult.text;
        pageCount = pdfResult.pageCount;
        segments = pdfResult.segments;
        requiresOcr = pdfResult.requiresOcr;
        ocrReason = pdfResult.ocrReason;
      } else if (input.kind === 'table') {
        const isXlsx = input.name.toLowerCase().endsWith('.xlsx');
        if (isXlsx) {
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const tableResult = await parseXlsxTable(bytes);
          text = tableResult.markdown;
          segments = tableResult.segments;
        } else {
          mimeType = 'text/csv';
          const rawText = decodeText(bytes);
          const delimiter = input.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
          const tableResult = parseDelimitedTable(rawText, delimiter);
          text = tableResult.markdown;
          segments = tableResult.segments;
        }
      } else if (input.kind === 'text-file') {
        text = decodeText(bytes);
        segments = extractSegmentsFromText(text);
      }
    } else if (input.text !== undefined) {
      text = input.text;
      segments = extractSegmentsFromText(text);
    } else if (input.kind === 'asset') {
      text = `[Asset: ${input.name}]`;
    }

    if (text.length > SOURCE_MAX_CHARACTERS) {
      text = text.slice(0, SOURCE_MAX_CHARACTERS);
    }

    const contentHash = await computeSha256(rawBytes || text);
    const id = `src-${contentHash.slice(7, 23)}`;

    const reference: SourceReferenceV1 = sourceReferenceSchema.parse({
      schemaVersion: 1,
      id,
      projectId: input.projectId,
      name: input.name,
      kind: input.kind,
      mimeType,
      contentHash,
      characterCount: text.length,
      pageCount,
      segments,
      requiresOcr,
      ocrReason,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    });

    this.sources.set(id, {
      reference,
      fullText: text,
      rawBytes,
    });

    return reference;
  }

  getSource(id: string): SourceReferenceV1 | undefined {
    return this.sources.get(id)?.reference;
  }

  getSourceRecord(id: string): SourceRecord | undefined {
    return this.sources.get(id);
  }

  listSources(projectId?: string): SourceReferenceV1[] {
    const all = Array.from(this.sources.values()).map((r) => r.reference);
    if (!projectId) return all;
    return all.filter((s) => s.projectId === projectId);
  }

  async readSource(params: SourceReadParams): Promise<SourceReadResult> {
    const record = this.sources.get(params.sourceId);
    if (!record) {
      throw new Error(`未找到来源数据：${params.sourceId}`);
    }

    const { reference, fullText } = record;
    if (reference.requiresOcr) {
      return {
        sourceId: reference.id,
        name: reference.name,
        kind: reference.kind,
        contentHash: reference.contentHash,
        totalCharacters: 0,
        cursor: 0,
        textChunk: '',
        nextCursor: null,
        isEof: true,
        requiresOcr: true,
        ocrReason: reference.ocrReason,
      };
    }

    let targetText = fullText;
    let activeSegment: SourceSegmentV1 | undefined;

    if (params.segmentId) {
      activeSegment = reference.segments.find((s) => s.id === params.segmentId);
      if (activeSegment) {
        targetText = fullText.slice(activeSegment.charStart, activeSegment.charEnd);
      }
    }

    const totalCharacters = targetText.length;
    const cursor = Math.max(params.cursor ?? 0, 0);
    const limit = Math.min(Math.max(params.limitCharacters ?? SOURCE_READ_MAX_CHUNK, 1), SOURCE_READ_MAX_CHUNK);

    const chunk = targetText.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < totalCharacters ? cursor + limit : null;
    const isEof = nextCursor === null;

    return {
      sourceId: reference.id,
      name: reference.name,
      kind: reference.kind,
      contentHash: reference.contentHash,
      totalCharacters,
      cursor,
      textChunk: chunk,
      nextCursor,
      isEof,
      requiresOcr: false,
      activeSegment,
    };
  }

  inspectSource(sourceId: string): SourceInspectResult {
    const ref = this.getSource(sourceId);
    if (!ref) {
      throw new Error(`未找到来源数据：${sourceId}`);
    }
    return {
      sourceId: ref.id,
      projectId: ref.projectId,
      name: ref.name,
      kind: ref.kind,
      mimeType: ref.mimeType,
      contentHash: ref.contentHash,
      characterCount: ref.characterCount,
      pageCount: ref.pageCount,
      segments: ref.segments,
      requiresOcr: ref.requiresOcr,
      ocrReason: ref.ocrReason,
      metadata: ref.metadata,
    };
  }

  deleteSource(id: string): boolean {
    return this.sources.delete(id);
  }

  clearSources(): void {
    this.sources.clear();
  }
}

export const sourceRepository = new SourceRepository();
