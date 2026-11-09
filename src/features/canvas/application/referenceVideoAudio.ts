/** Inspect ISO-BMFF track metadata without decoding video or requiring a native command. */
export function referenceVideoHasAudio(source: string): boolean | undefined {
  if (!/^data:video\/(?:mp4|quicktime|x-m4v);base64,/i.test(source)) return undefined;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), char => char.charCodeAt(0)); }
  catch { return undefined; }
  const view = new DataView(bytes.buffer);
  const typeAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  let sawMovie = false;
  let sawVideo = false;
  let sawAudio = false;
  const scan = (start: number, end: number, depth: number): boolean => {
    if (depth > 4) return false;
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end) return false;
      let size = view.getUint32(offset);
      const type = typeAt(offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return false;
        size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
        header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) return false;
      const payload = offset + header;
      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        if (type === 'moov') sawMovie = true;
        if (!scan(payload, offset + size, depth + 1)) return false;
      } else if (type === 'hdlr') {
        // FullBox flags/version + pre_defined precede the four-byte handler type.
        if (payload + 12 > offset + size) return false;
        sawAudio ||= typeAt(payload + 8) === 'soun';
        sawVideo ||= typeAt(payload + 8) === 'vide';
      }
      offset += size;
    }
    return true;
  };
  if (!scan(0, bytes.length, 0) || !sawMovie || !sawVideo) return undefined;
  return sawAudio;
}
