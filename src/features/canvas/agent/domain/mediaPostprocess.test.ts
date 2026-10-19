import { describe, expect, it } from 'vitest';
import {
  formatSrt,
  parseSrtOrVtt,
  validateSubtitles,
  validateVoiceReferenceDuration,
} from './mediaPostprocess';

describe('Media Postprocess Domain & Subtitle Pipeline (T11)', () => {
  describe('SRT & WebVTT Parsing and Formatting (A19)', () => {
    it('parses standard SRT with exact Chinese text, punctuation and brackets', () => {
      const srt = `1
00:00:01,000 --> 00:00:03,500
你好{世界}！【第1集】

2
00:00:04,000 --> 00:00:06,200
这是第二行台词："保持专注。"`;

      const cues = parseSrtOrVtt(srt);
      expect(cues).toHaveLength(2);
      expect(cues[0]).toEqual({
        id: '1',
        startSeconds: 1.0,
        endSeconds: 3.5,
        text: '你好{世界}！【第1集】',
      });
      expect(cues[1]).toEqual({
        id: '2',
        startSeconds: 4.0,
        endSeconds: 6.2,
        text: '这是第二行台词："保持专注。"',
      });
    });

    it('parses WebVTT format stripping header', () => {
      const vtt = `WEBVTT

00:00:02.500 --> 00:00:05.000
WebVTT 字幕文本展示

00:00:05.500 --> 00:00:08.000
第二段说明文字`;

      const cues = parseSrtOrVtt(vtt);
      expect(cues).toHaveLength(2);
      expect(cues[0].startSeconds).toBe(2.5);
      expect(cues[0].endSeconds).toBe(5.0);
      expect(cues[0].text).toBe('WebVTT 字幕文本展示');
    });

    it('formats normalized cues into valid SRT', () => {
      const cues = [
        { id: '1', startSeconds: 1.5, endSeconds: 4.0, text: '第一句' },
        { id: '2', startSeconds: 4.5, endSeconds: 7.25, text: '第二句' },
      ];

      const srt = formatSrt(cues);
      expect(srt).toContain('00:00:01,500 --> 00:00:04,000');
      expect(srt).toContain('第一句');
      expect(srt).toContain('00:00:04,500 --> 00:00:07,250');
      expect(srt).toContain('第二句');
    });
  });

  describe('Subtitle Validation Rules', () => {
    it('rejects empty cue lists', () => {
      const result = validateSubtitles([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('字幕条目列表不能为空。');
    });

    it('rejects negative start time or end before start', () => {
      const invalid = [
        { id: '1', startSeconds: -1.0, endSeconds: 2.0, text: '有效文本' },
        { id: '2', startSeconds: 5.0, endSeconds: 4.0, text: '反转时间' },
      ];
      const result = validateSubtitles(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('不能为负数'))).toBe(true);
      expect(result.errors.some((e) => e.includes('必须大于起始时间'))).toBe(true);
    });

    it('rejects overlapping subtitle cues on the same timeline', () => {
      const overlapping = [
        { id: '1', startSeconds: 1.0, endSeconds: 4.0, text: '第一句' },
        { id: '2', startSeconds: 3.5, endSeconds: 6.0, text: '重叠句' },
      ];
      const result = validateSubtitles(overlapping);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('存在时间重叠'))).toBe(true);
    });

    it('accepts strictly non-overlapping, positive cues', () => {
      const valid = [
        { id: '1', startSeconds: 0.0, endSeconds: 2.5, text: '开场白' },
        { id: '2', startSeconds: 3.0, endSeconds: 5.5, text: '主体阐述' },
      ];
      const result = validateSubtitles(valid);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Audio Reference Duration Constraint (> 2.0s rule)', () => {
    it('accepts audio duration strictly greater than 2.0s', () => {
      expect(validateVoiceReferenceDuration(2.05).valid).toBe(true);
      expect(validateVoiceReferenceDuration(3.5).valid).toBe(true);
      expect(validateVoiceReferenceDuration(15.0).valid).toBe(true);
    });

    it('strictly rejects audio duration <= 2.0s without rounding up', () => {
      const exactlyTwo = validateVoiceReferenceDuration(2.0);
      expect(exactlyTwo.valid).toBe(false);
      expect(exactlyTwo.error).toContain('必须严格大于 2.0 秒');
      expect(exactlyTwo.error).toContain('严禁四舍五入');

      const belowTwo = validateVoiceReferenceDuration(1.99);
      expect(belowTwo.valid).toBe(false);

      const invalid = validateVoiceReferenceDuration(-0.5);
      expect(invalid.valid).toBe(false);
    });
  });
});
