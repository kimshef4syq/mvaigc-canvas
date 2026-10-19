import { describe, expect, it, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  sourceRepository,
  extractDocxText,
  parseDelimitedTable,
  extractPdfText,
  computeSha256,
} from './sourceRepository';

describe('sourceRepository & sourceImporter', () => {
  beforeEach(() => {
    sourceRepository.clearSources();
  });

  describe('computeSha256', () => {
    it('generates sha256 prefix and 64-char hex digest', async () => {
      const hash = await computeSha256('hello world');
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(hash).toBe('sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });
  });

  describe('pasted-text import & bounded reading', () => {
    it('imports pasted script text and generates stable source reference', async () => {
      const script = `# 第一集 离别
镜头 1：暴雨中的车站，男主站在伞下。
镜头 2：女主拖着行李箱走过积水。

# 第二集 重逢
镜头 3：三年后的阳光咖啡厅。`;

      const ref = await sourceRepository.importSource({
        projectId: 'test-project',
        name: '离别重逢剧本.txt',
        kind: 'pasted-text',
        text: script,
      });

      expect(ref.id).toMatch(/^src-[a-f0-9]{16}$/);
      expect(ref.kind).toBe('pasted-text');
      expect(ref.characterCount).toBe(script.length);
      expect(ref.segments.length).toBeGreaterThanOrEqual(2);
      expect(ref.segments[0].label).toBe('第一集 离别');
      expect(ref.requiresOcr).toBe(false);

      // Read with default limit
      const readResult = await sourceRepository.readSource({ sourceId: ref.id });
      expect(readResult.isEof).toBe(true);
      expect(readResult.textChunk).toBe(script);
      expect(readResult.nextCursor).toBeNull();
    });

    it('supports bounded cursor pagination for long documents', async () => {
      const longText = 'A'.repeat(25_000);
      const ref = await sourceRepository.importSource({
        projectId: 'test-project',
        name: '超长剧本.txt',
        kind: 'pasted-text',
        text: longText,
      });

      // Page 1
      const page1 = await sourceRepository.readSource({
        sourceId: ref.id,
        cursor: 0,
        limitCharacters: 10_000,
      });
      expect(page1.textChunk.length).toBe(10_000);
      expect(page1.cursor).toBe(0);
      expect(page1.nextCursor).toBe(10_000);
      expect(page1.isEof).toBe(false);

      // Page 2
      const page2 = await sourceRepository.readSource({
        sourceId: ref.id,
        cursor: page1.nextCursor!,
        limitCharacters: 10_000,
      });
      expect(page2.textChunk.length).toBe(10_000);
      expect(page2.cursor).toBe(10_000);
      expect(page2.nextCursor).toBe(20_000);
      expect(page2.isEof).toBe(false);

      // Page 3 (EOF)
      const page3 = await sourceRepository.readSource({
        sourceId: ref.id,
        cursor: page2.nextCursor!,
        limitCharacters: 10_000,
      });
      expect(page3.textChunk.length).toBe(5_000);
      expect(page3.cursor).toBe(20_000);
      expect(page3.nextCursor).toBeNull();
      expect(page3.isEof).toBe(true);
    });
  });

  describe('DOCX parsing', () => {
    it('extracts paragraphs from docx word/document.xml', () => {
      const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>第1场 会议室 日 内</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>张总：这次的项目很关键。</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>李明点头记录。</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

      const docxBytes = zipSync({
        'word/document.xml': strToU8(docXml),
      });

      const { text, segments } = extractDocxText(docxBytes);
      expect(text).toContain('第1场 会议室 日 内');
      expect(text).toContain('张总：这次的项目很关键。');
      expect(segments.length).toBeGreaterThanOrEqual(1);
    });

    it('throws descriptive error if word/document.xml is missing', () => {
      const invalidZip = zipSync({
        'other.xml': strToU8('<root />'),
      });
      expect(() => extractDocxText(invalidZip)).toThrow(/未找到 word\/document\.xml/);
    });
  });

  describe('Table & CSV parsing', () => {
    it('parses CSV into structured markdown table with header and row bounds', () => {
      const csv = `镜头号,画面描述,景别,时长\n1,男主奔跑在雨中,特写,3秒\n2,女主回眸,全景,4秒`;
      const { markdown, rowCount, colCount, segments } = parseDelimitedTable(csv, ',');
      expect(rowCount).toBe(3);
      expect(colCount).toBe(4);
      expect(markdown).toContain('| 镜头号 | 画面描述 | 景别 | 时长 |');
      expect(markdown).toContain('| 1 | 男主奔跑在雨中 | 特写 | 3秒 |');
      expect(segments.length).toBe(2);
    });
  });

  describe('PDF parsing & OCR requirement detection', () => {
    it('detects scanned PDF without text layer and marks requiresOcr = true', () => {
      const scannedPdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> >>
endobj
4 0 obj
<< /Type /XObject /Subtype /Image /Width 100 /Height 100 >>
stream
image-binary-data
endstream
endobj
xref
trailer
<< /Root 1 0 R >>
%%EOF`;

      const buffer = strToU8(scannedPdf);
      const result = extractPdfText(buffer);
      expect(result.requiresOcr).toBe(true);
      expect(result.ocrReason).toContain('需要 OCR 识别服务');
      expect(result.text).toBe('');
    });

    it('extracts text from standard text PDF stream', () => {
      const textPdf = `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
2 0 obj
<< /Length 40 >>
stream
BT
/F1 12 Tf
(第1集 剧本文本) Tj
ET
endstream
endobj
%%EOF`;

      const buffer = strToU8(textPdf);
      const result = extractPdfText(buffer);
      expect(result.requiresOcr).toBe(false);
      expect(result.text).toContain('第1集 剧本文本');
    });

    it('rejects files without %PDF- header', () => {
      expect(() => extractPdfText(strToU8('not a pdf'))).toThrow(/缺少 %PDF- 文件标识/);
    });
  });

  describe('file size and validation limits', () => {
    it('rejects files exceeding 20MB', async () => {
      const largeBytes = new Uint8Array(21 * 1024 * 1024);
      await expect(
        sourceRepository.importSource({
          projectId: 'p1',
          name: 'too-big.txt',
          kind: 'text-file',
          buffer: largeBytes,
        })
      ).rejects.toThrow(/文件大小超出限制/);
    });
  });
});
