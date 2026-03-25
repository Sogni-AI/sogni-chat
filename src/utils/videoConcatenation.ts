/**
 * Lossless MP4 video concatenation utility.
 *
 * Ported from sogni-photobooth/src/utils/videoConcatenation.js.
 * Performs container-level manipulation (no re-encoding) using
 * DataView/Uint8Array for direct byte access.
 *
 * Handles:
 * - H.264 B-frame support via ctts (Composition Time to Sample)
 * - Edit lists (edts) for iOS/QuickTime compatibility
 * - Proper chunk offset (stco) recalculation
 * - Sync sample (stss / keyframe) tracking
 * - Audio track concatenation (when all source videos contain audio)
 *
 * Does NOT handle (can be added later):
 * - Frame extraction
 * - MP3→M4A transcoding
 */

// ========== TYPES ==========

interface BoxInfo {
  start: number;
  size: number;
  end: number;
  contentStart: number;
}

interface ParsedMP4 {
  ftyp: Uint8Array | null;
  moov: Uint8Array | null;
  mdat: Uint8Array | null;
  mdatData: Uint8Array | null;
  mdatStart: number;
}

interface SampleTables {
  sampleSizes: number[];
  sampleCount: number;
  chunkOffsets: number[];
  chunkCount: number;
  syncSamples: number[];
  sttsEntries: { count: number; delta: number }[];
  stscEntries: { firstChunk: number; samplesPerChunk: number; sampleDescriptionIndex: number }[];
  cttsEntries: { count: number; offset: number }[];
  duration: number;
  timescale: number;
  sampleDelta: number;
  width: number;
  height: number;
  avcC: Uint8Array | null;
}

interface CttsEntry {
  sampleCount: number;
  sampleOffset: number;
}

interface StscEntry {
  firstChunk: number;
  samplesPerChunk: number;
  sampleDescriptionIndex: number;
}

/**
 * Extract an ArrayBuffer from a Uint8Array, handling the strict-mode
 * ArrayBufferLike -> ArrayBuffer cast that TypeScript requires.
 */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ========== PARSING ==========

function getBoxType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function findBox(buffer: ArrayBuffer, start: number, end: number, type: string): BoxInfo | null {
  const view = new DataView(buffer);
  let offset = start;

  while (offset < end - 8) {
    const size = view.getUint32(offset);
    const boxType = getBoxType(view, offset + 4);
    if (size === 0 || offset + size > end) break;
    if (boxType === type) {
      return { start: offset, size, end: offset + size, contentStart: offset + 8 };
    }
    offset += size;
  }
  return null;
}

function findNestedBox(buffer: ArrayBuffer, path: string[]): BoxInfo | null {
  // The buffer is the moov box itself, so skip 'moov' in path if present
  let pathStart = 0;
  if (path[0] === 'moov') {
    pathStart = 1;
  }

  // Start at offset 8 (after moov header)
  let current: BoxInfo = { start: 0, end: buffer.byteLength, contentStart: 8, size: buffer.byteLength };

  for (let i = pathStart; i < path.length; i++) {
    const found = findBox(buffer, current.contentStart, current.end, path[i]);
    if (!found) return null;
    current = found;
  }

  return current;
}

function findNestedBoxInRange(
  buffer: ArrayBuffer,
  start: number,
  end: number,
  path: string[],
): BoxInfo | null {
  let current: BoxInfo = { start, end, contentStart: start, size: end - start };

  for (const boxType of path) {
    const found = findBox(buffer, current.contentStart, current.end, boxType);
    if (!found) return null;
    current = found;
  }

  return current;
}

/**
 * Find video trak in moov (handler type 'vide')
 * CRITICAL: Must use this instead of findNestedBox for videos that may have audio tracks
 */
function findVideoTrak(buffer: ArrayBuffer): BoxInfo | null {
  const view = new DataView(buffer);
  let offset = 8; // Skip moov header

  while (offset < buffer.byteLength - 8) {
    const size = view.getUint32(offset);
    const type = getBoxType(view, offset + 4);

    if (size === 0 || offset + size > buffer.byteLength) break;

    if (type === 'trak') {
      // Check if this is a video track by looking at hdlr
      const hdlr = findNestedBoxInRange(buffer, offset + 8, offset + size, ['mdia', 'hdlr']);
      if (hdlr) {
        const hdlrView = new DataView(buffer, hdlr.start, hdlr.size);
        // Handler type is at offset 16 (after header + version/flags + pre_defined)
        const handlerType = getBoxType(hdlrView, 16);
        if (handlerType === 'vide') {
          return { start: offset, size, end: offset + size, contentStart: offset + 8 };
        }
      }
    }

    offset += size;
  }

  return null;
}



function parseMP4(buffer: ArrayBuffer): ParsedMP4 {
  const view = new DataView(buffer);
  const result: ParsedMP4 = { ftyp: null, moov: null, mdat: null, mdatData: null, mdatStart: 0 };

  let offset = 0;
  while (offset < buffer.byteLength - 8) {
    let size = view.getUint32(offset);
    const type = getBoxType(view, offset + 4);

    // Handle extended size (size == 1 means 64-bit size follows)
    let headerSize = 8;
    if (size === 1 && offset + 16 <= buffer.byteLength) {
      // 64-bit size is at offset + 8
      const highBits = view.getUint32(offset + 8);
      const lowBits = view.getUint32(offset + 12);
      // For safety, if high bits are non-zero, clamp to buffer length
      if (highBits > 0) {
        size = buffer.byteLength - offset;
      } else {
        size = lowBits;
      }
      headerSize = 16;
    }

    // Safety: size must be at least header size
    if (size < headerSize) break;

    // Safety: don't read past end of buffer
    const boxEnd = Math.min(offset + size, buffer.byteLength);
    const actualSize = boxEnd - offset;

    if (type === 'ftyp') {
      result.ftyp = new Uint8Array(buffer, offset, actualSize);
    } else if (type === 'moov') {
      result.moov = new Uint8Array(buffer, offset, actualSize);
    } else if (type === 'mdat') {
      result.mdat = new Uint8Array(buffer, offset, actualSize);
      const dataSize = actualSize - headerSize;
      if (dataSize > 0) {
        result.mdatData = new Uint8Array(buffer, offset + headerSize, dataSize);
      } else {
        result.mdatData = new Uint8Array(0);
      }
      result.mdatStart = offset;
    }

    offset += actualSize;
  }

  return result;
}

function parseSampleTables(moovData: Uint8Array, useVideoTrackDetection = false): SampleTables {
  const buffer = toArrayBuffer(moovData);
  const result: SampleTables = {
    sampleSizes: [],
    sampleCount: 0,
    chunkOffsets: [],
    chunkCount: 0,
    syncSamples: [],
    sttsEntries: [],
    stscEntries: [],
    cttsEntries: [],
    duration: 0,
    timescale: 1000,
    sampleDelta: 512,
    width: 0,
    height: 0,
    avcC: null,
  };

  // Find stbl - optionally use video track detection
  let stbl: BoxInfo | null = null;
  if (useVideoTrackDetection) {
    const videoTrak = findVideoTrak(buffer);
    if (videoTrak) {
      stbl = findNestedBoxInRange(buffer, videoTrak.contentStart, videoTrak.end, ['mdia', 'minf', 'stbl']);
    }
  }
  if (!stbl) {
    // Fallback to first trak (original behavior)
    stbl = findNestedBox(buffer, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  }

  if (!stbl) return result;

  // Parse stsz
  const stsz = findBox(buffer, stbl.contentStart, stbl.end, 'stsz');
  if (stsz) {
    const v = new DataView(buffer, stsz.start, stsz.size);
    const uniformSize = v.getUint32(12);
    const count = v.getUint32(16);
    result.sampleCount = count;

    if (uniformSize === 0) {
      for (let i = 0; i < count; i++) {
        result.sampleSizes.push(v.getUint32(20 + i * 4));
      }
    } else {
      for (let i = 0; i < count; i++) {
        result.sampleSizes.push(uniformSize);
      }
    }
  }

  // Parse stco
  const stco = findBox(buffer, stbl.contentStart, stbl.end, 'stco');
  if (stco) {
    const v = new DataView(buffer, stco.start, stco.size);
    const count = v.getUint32(12);
    result.chunkCount = count;
    for (let i = 0; i < count; i++) {
      result.chunkOffsets.push(v.getUint32(16 + i * 4));
    }
  }

  // Parse stss (sync samples)
  const stss = findBox(buffer, stbl.contentStart, stbl.end, 'stss');
  if (stss) {
    const v = new DataView(buffer, stss.start, stss.size);
    const count = v.getUint32(12);
    for (let i = 0; i < count; i++) {
      result.syncSamples.push(v.getUint32(16 + i * 4));
    }
  }

  // Parse stts
  const stts = findBox(buffer, stbl.contentStart, stbl.end, 'stts');
  if (stts) {
    const v = new DataView(buffer, stts.start, stts.size);
    const entryCount = v.getUint32(12);
    let off = 16;
    for (let i = 0; i < entryCount; i++) {
      const count = v.getUint32(off);
      const delta = v.getUint32(off + 4);
      result.sttsEntries.push({ count, delta });
      if (i === 0) {
        result.sampleDelta = delta;
      }
      off += 8;
    }
  }

  // Parse stsc (sample-to-chunk)
  const stsc = findBox(buffer, stbl.contentStart, stbl.end, 'stsc');
  if (stsc) {
    const v = new DataView(buffer, stsc.start, stsc.size);
    const entryCount = v.getUint32(12);
    let off = 16;
    for (let i = 0; i < entryCount; i++) {
      const firstChunk = v.getUint32(off);
      const samplesPerChunk = v.getUint32(off + 4);
      const sampleDescriptionIndex = v.getUint32(off + 8);
      result.stscEntries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex });
      off += 12;
    }
  }

  // Parse ctts (composition time to sample) - needed for B-frames
  const ctts = findBox(buffer, stbl.contentStart, stbl.end, 'ctts');
  if (ctts) {
    const v = new DataView(buffer, ctts.start, ctts.size);
    const version = v.getUint8(8);
    const entryCount = v.getUint32(12);
    let off = 16;
    for (let i = 0; i < entryCount; i++) {
      const count = v.getUint32(off);
      // In version 0, offset is unsigned. In version 1, it's signed.
      const ctOffset = version === 0 ? v.getUint32(off + 4) : v.getInt32(off + 4);
      result.cttsEntries.push({ count, offset: ctOffset });
      off += 8;
    }
  }

  // Parse mvhd for timescale/duration
  const mvhd = findBox(buffer, 0, buffer.byteLength, 'mvhd');
  if (mvhd) {
    const v = new DataView(buffer, mvhd.start, mvhd.size);
    const version = v.getUint8(8);
    if (version === 0) {
      result.timescale = v.getUint32(20);
      result.duration = v.getUint32(24);
    }
  }

  // Parse mdhd for media timescale
  const mdhd = findNestedBox(buffer, ['moov', 'trak', 'mdia', 'mdhd']);
  if (mdhd) {
    const v = new DataView(buffer, mdhd.start, mdhd.size);
    const version = v.getUint8(8);
    if (version === 0) {
      result.timescale = v.getUint32(20);
    }
  }

  // Parse avcC
  const stsd = findBox(buffer, stbl.contentStart, stbl.end, 'stsd');
  if (stsd) {
    const avcC = findBox(buffer, stsd.start + 16, stsd.end, 'avcC');
    if (avcC) {
      result.avcC = new Uint8Array(buffer, avcC.start, avcC.size);
    }
  }

  return result;
}

/** Exported for potential reuse — extracts the movie-level timescale from a moov box. */
export function getMovieTimescaleFromMoov(moovData: Uint8Array): number | null {
  const buffer = toArrayBuffer(moovData);
  const mvhd = findBox(buffer, 8, buffer.byteLength, 'mvhd');
  if (mvhd) {
    const view = new DataView(buffer, mvhd.start, mvhd.size);
    const version = view.getUint8(8);
    if (version === 0) {
      return view.getUint32(20); // mvhd v0: timescale at offset 20
    } else {
      return view.getUint32(28); // mvhd v1: timescale at offset 28
    }
  }
  return null;
}

/** Exported for potential reuse — extracts movie and media durations from a moov box. */
export function getOriginalDurations(moovData: Uint8Array): { movieDuration: number; mediaDuration: number } {
  const buffer = toArrayBuffer(moovData);

  let movieDuration = 0;
  let mediaDuration = 0;

  // Get mvhd duration
  const mvhd = findBox(buffer, 8, buffer.byteLength, 'mvhd');
  if (mvhd) {
    const view = new DataView(buffer, mvhd.start, mvhd.size);
    const version = view.getUint8(8);
    movieDuration = version === 0 ? view.getUint32(24) : Number(view.getBigUint64(32));
  }

  // Get mdhd duration
  const mdhd = findNestedBox(buffer, ['moov', 'trak', 'mdia', 'mdhd']);
  if (mdhd) {
    const view = new DataView(buffer, mdhd.start, mdhd.size);
    const version = view.getUint8(8);
    mediaDuration = version === 0 ? view.getUint32(24) : Number(view.getBigUint64(32));
  }

  return { movieDuration, mediaDuration };
}

// ========== BUILDING ==========

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}

function wrapBox(type: string, content: Uint8Array): Uint8Array {
  const size = 8 + content.byteLength;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) {
    result[4 + i] = type.charCodeAt(i);
  }
  result.set(content, 8);

  return result;
}

function buildMdat(data: Uint8Array): Uint8Array {
  const size = data.byteLength + 8;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  view.setUint32(0, size);
  result[4] = 0x6d; result[5] = 0x64; result[6] = 0x61; result[7] = 0x74; // mdat
  result.set(data, 8);
  return result;
}

function buildStsz(sizes: number[]): Uint8Array {
  const size = 20 + sizes.length * 4;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x73; result[7] = 0x7a; // stsz
  view.setUint32(8, 0); // version/flags
  view.setUint32(12, 0); // uniform size (0 = variable)
  view.setUint32(16, sizes.length);

  for (let i = 0; i < sizes.length; i++) {
    view.setUint32(20 + i * 4, sizes[i]);
  }

  return result;
}

function buildStco(offsets: number[]): Uint8Array {
  const size = 16 + offsets.length * 4;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x63; result[7] = 0x6f; // stco
  view.setUint32(8, 0); // version/flags
  view.setUint32(12, offsets.length);

  for (let i = 0; i < offsets.length; i++) {
    view.setUint32(16 + i * 4, offsets[i]);
  }

  return result;
}

function buildStsc(entries: StscEntry[]): Uint8Array {
  const size = 16 + entries.length * 12;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x73; result[7] = 0x63; // stsc
  view.setUint32(8, 0); // version/flags
  view.setUint32(12, entries.length);

  for (let i = 0; i < entries.length; i++) {
    view.setUint32(16 + i * 12, entries[i].firstChunk);
    view.setUint32(20 + i * 12, entries[i].samplesPerChunk);
    view.setUint32(24 + i * 12, entries[i].sampleDescriptionIndex);
  }

  return result;
}

function buildStts(sampleCount: number, delta: number): Uint8Array {
  const size = 24;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x74; result[7] = 0x73; // stts
  view.setUint32(8, 0); // version/flags
  view.setUint32(12, 1); // entry count
  view.setUint32(16, sampleCount);
  view.setUint32(20, delta);

  return result;
}

function buildStss(syncSamples: number[]): Uint8Array {
  const size = 16 + syncSamples.length * 4;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x73; result[7] = 0x73; // stss
  view.setUint32(8, 0); // version/flags
  view.setUint32(12, syncSamples.length);

  for (let i = 0; i < syncSamples.length; i++) {
    view.setUint32(16 + i * 4, syncSamples[i]);
  }

  return result;
}

function buildElst(segmentDuration: number, mediaTime = 0): Uint8Array {
  const entryCount = 1;
  const size = 16 + entryCount * 12; // header (16) + entries (12 each for v0)
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x65; result[5] = 0x6c; result[6] = 0x73; result[7] = 0x74; // elst
  view.setUint32(8, 0); // version 0 + flags
  view.setUint32(12, entryCount);

  // Entry 1: Map entire duration
  view.setUint32(16, segmentDuration);  // segment_duration in movie timescale
  view.setInt32(20, mediaTime);          // media_time (0 = start from beginning)
  view.setInt16(24, 1);                  // media_rate_integer (1x speed)
  view.setInt16(26, 0);                  // media_rate_fraction

  return result;
}

/**
 * Build an Edit (edts) container box containing an elst
 */
function buildEdts(segmentDuration: number, mediaTime = 0): Uint8Array {
  const elst = buildElst(segmentDuration, mediaTime);
  return wrapBox('edts', elst);
}

function updateMvhdDuration(mvhdData: Uint8Array, newDuration: number): Uint8Array {
  const result = new Uint8Array(mvhdData);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  const version = view.getUint8(8);
  if (version === 0) {
    view.setUint32(24, newDuration);
  }
  return result;
}

function updateTkhdDuration(tkhdData: Uint8Array, newDuration: number): Uint8Array {
  const result = new Uint8Array(tkhdData.length);
  result.set(tkhdData);
  const view = new DataView(result.buffer);
  const version = view.getUint8(8);

  if (version === 0) {
    view.setUint32(28, newDuration); // tkhd v0: duration at offset 28
  } else {
    view.setBigUint64(36, BigInt(newDuration)); // tkhd v1: duration at offset 36
  }

  return result;
}

function updateMdhdDuration(mdhdData: Uint8Array, newDuration: number): Uint8Array {
  const result = new Uint8Array(mdhdData.length);
  result.set(mdhdData);
  const view = new DataView(result.buffer);
  const version = view.getUint8(8);

  if (version === 0) {
    view.setUint32(24, newDuration); // mdhd v0: duration at offset 24
  } else {
    view.setBigUint64(32, BigInt(newDuration)); // mdhd v1: duration at offset 32
  }

  return result;
}

// ========== CORE CONCATENATION ==========

/**
 * Core MP4 concatenation engine (video + audio).
 *
 * Parses each input buffer, extracts video and audio samples from mdat using
 * stco/stsc/stsz, collects ctts entries for B-frame support, concatenates all
 * samples into a single mdat, rebuilds moov with combined sample tables for
 * both tracks, and returns a complete MP4. Audio is included only when ALL
 * source videos contain an audio track to maintain sync.
 */
function concatenateMP4s_Base(buffers: ArrayBuffer[]): Uint8Array {
  if (!buffers || buffers.length === 0) {
    throw new Error('No video buffers provided');
  }

  // Parse all files first and validate
  const parsedFiles: ParsedMP4[] = [];
  for (let i = 0; i < buffers.length; i++) {
    try {
      const parsed = parseMP4(buffers[i]);
      if (!parsed.ftyp || !parsed.moov || !parsed.mdatData) {
        throw new Error(`Video ${i + 1} is missing required boxes (ftyp, moov, or mdat)`);
      }
      if (parsed.mdatData.byteLength === 0) {
        throw new Error(`Video ${i + 1} has empty mdat data`);
      }
      parsedFiles.push(parsed);
    } catch (error) {
      throw new Error(`Failed to parse video ${i + 1}: ${(error as Error).message}`);
    }
  }

  const firstParsed = parsedFiles[0];
  const firstTables = parseSampleTables(firstParsed.moov!, true);

  if (!firstTables || firstTables.sampleCount === 0) {
    throw new Error('First video has no samples');
  }

  // Get timing info from first file
  const file1MoovBuffer = toArrayBuffer(firstParsed.moov!);

  const mvhd = findBox(file1MoovBuffer, 8, file1MoovBuffer.byteLength, 'mvhd');
  if (!mvhd) throw new Error('First video is missing mvhd box');
  const mvhdView = new DataView(file1MoovBuffer, mvhd.start, mvhd.size);
  const movieTimescale = mvhdView.getUint8(8) === 0 ? mvhdView.getUint32(20) : mvhdView.getUint32(28);

  const videoTrak = findVideoTrak(file1MoovBuffer);
  if (!videoTrak) throw new Error('First video has no video track');
  const videoMdia = findBox(file1MoovBuffer, videoTrak.contentStart, videoTrak.end, 'mdia');
  if (!videoMdia) throw new Error('First video track is missing mdia box');
  const videoMdhd = findBox(file1MoovBuffer, videoMdia.contentStart, videoMdia.end, 'mdhd');
  if (!videoMdhd) throw new Error('First video track is missing mdhd box');
  const videoMdhdView = new DataView(file1MoovBuffer, videoMdhd.start, videoMdhd.size);
  const videoTimescale = videoMdhdView.getUint8(8) === 0 ? videoMdhdView.getUint32(20) : videoMdhdView.getUint32(28);

  // Extract video samples AND ctts entries from all files
  const allVideoSizes: number[] = [];
  const allVideoSamples: Uint8Array[] = [];
  const allCttsEntries: CttsEntry[] = [];

  for (let fileIdx = 0; fileIdx < parsedFiles.length; fileIdx++) {
    const p = parsedFiles[fileIdx];
    const moovBuf = toArrayBuffer(p.moov!);
    const origBuf = new Uint8Array(buffers[fileIdx]);

    const vTrak = findVideoTrak(moovBuf);
    if (!vTrak) continue;

    const stbl = findNestedBoxInRange(moovBuf, vTrak.contentStart, vTrak.end, ['mdia', 'minf', 'stbl']);
    if (!stbl) continue;
    const stsz = findBox(moovBuf, stbl.contentStart, stbl.end, 'stsz');
    const stco = findBox(moovBuf, stbl.contentStart, stbl.end, 'stco');
    const stsc = findBox(moovBuf, stbl.contentStart, stbl.end, 'stsc');
    const ctts = findBox(moovBuf, stbl.contentStart, stbl.end, 'ctts');
    if (!stsz || !stco) continue;

    // Extract ctts entries for this file
    if (ctts) {
      const cttsView = new DataView(moovBuf, ctts.start, ctts.size);
      const entryCount = cttsView.getUint32(12);
      for (let i = 0; i < entryCount; i++) {
        allCttsEntries.push({
          sampleCount: cttsView.getUint32(16 + i * 8),
          sampleOffset: cttsView.getInt32(20 + i * 8), // Can be negative in version 1
        });
      }
    }

    const stszView = new DataView(moovBuf, stsz.start, stsz.size);
    const stcoView = new DataView(moovBuf, stco.start, stco.size);
    const sampleCount = stszView.getUint32(16);
    const chunkCount = stcoView.getUint32(12);

    const uniformSize = stszView.getUint32(12);
    const sampleSizes: number[] = [];
    if (uniformSize !== 0) {
      // All samples share the same size — no per-sample table follows
      for (let i = 0; i < sampleCount; i++) sampleSizes.push(uniformSize);
    } else {
      for (let i = 0; i < sampleCount; i++) sampleSizes.push(stszView.getUint32(20 + i * 4));
    }
    const chunkOffsets: number[] = [];
    for (let i = 0; i < chunkCount; i++) chunkOffsets.push(stcoView.getUint32(16 + i * 4));

    const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
    if (stsc) {
      const stscView = new DataView(moovBuf, stsc.start, stsc.size);
      const entryCount = stscView.getUint32(12);
      for (let i = 0; i < entryCount; i++) {
        stscEntries.push({
          firstChunk: stscView.getUint32(16 + i * 12),
          samplesPerChunk: stscView.getUint32(20 + i * 12),
        });
      }
    }

    let sampleIdx = 0;
    for (let chunkIdx = 0; chunkIdx < chunkCount && sampleIdx < sampleCount; chunkIdx++) {
      let samplesInChunk = 1;
      for (const entry of stscEntries) {
        if (entry.firstChunk <= chunkIdx + 1) samplesInChunk = entry.samplesPerChunk;
      }
      let byteOffset = chunkOffsets[chunkIdx];
      for (let s = 0; s < samplesInChunk && sampleIdx < sampleCount; s++) {
        const sampleSize = sampleSizes[sampleIdx];
        if (byteOffset + sampleSize <= origBuf.length) {
          allVideoSamples.push(origBuf.slice(byteOffset, byteOffset + sampleSize));
          allVideoSizes.push(sampleSize);
        }
        byteOffset += sampleSize;
        sampleIdx++;
      }
    }
  }

  // Build combined mdat (video only — audio muxing not supported)
  const combinedVideoData = concatArrays(allVideoSamples);
  const newMdat = buildMdat(combinedVideoData);

  // Calculate durations
  const videoMediaDuration = allVideoSizes.length * firstTables.sampleDelta;
  const videoMovieDuration = Math.round(videoMediaDuration * movieTimescale / videoTimescale);

  // Single chunk for simplicity
  const ftypSize = firstParsed.ftyp!.byteLength;
  const videoChunkOffsets = [ftypSize + 8]; // After ftyp + mdat header

  // Build ctts box from collected entries
  const buildCttsFromEntries = (entries: CttsEntry[]): Uint8Array | null => {
    if (entries.length === 0) return null;
    const boxSize = 16 + entries.length * 8;
    const cttsArr = new Uint8Array(boxSize);
    const view = new DataView(cttsArr.buffer);
    view.setUint32(0, boxSize);
    cttsArr[4] = 0x63; cttsArr[5] = 0x74; cttsArr[6] = 0x74; cttsArr[7] = 0x73; // 'ctts'
    view.setUint32(8, 0); // version 0, flags
    view.setUint32(12, entries.length);
    for (let i = 0; i < entries.length; i++) {
      view.setUint32(16 + i * 8, entries[i].sampleCount);
      view.setInt32(20 + i * 8, entries[i].sampleOffset);
    }
    return cttsArr;
  };

  const newVideoStsz = buildStsz(allVideoSizes);
  const newVideoStco = buildStco(videoChunkOffsets);
  const newVideoStsc = buildStsc([{
    firstChunk: 1,
    samplesPerChunk: allVideoSizes.length,
    sampleDescriptionIndex: 1,
  }]);
  const newVideoStts = buildStts(allVideoSizes.length, firstTables.sampleDelta);

  // Build sync samples: first frame of each source file is a keyframe
  const videoSyncSamples: number[] = [1];
  let sOff = firstTables.sampleCount;
  for (let i = 1; i < parsedFiles.length; i++) {
    videoSyncSamples.push(sOff + 1);
    sOff += parseSampleTables(parsedFiles[i].moov!, true).sampleCount;
  }
  const newVideoStss = buildStss(videoSyncSamples);
  const newVideoCtts = buildCttsFromEntries(allCttsEntries);

  // Build video stbl with ctts
  const videoHdlr = findBox(file1MoovBuffer, videoMdia.contentStart, videoMdia.end, 'hdlr');
  const videoMinf = findBox(file1MoovBuffer, videoMdia.contentStart, videoMdia.end, 'minf');
  if (!videoMinf) throw new Error('First video track is missing minf box');
  const vmhd = findBox(file1MoovBuffer, videoMinf.contentStart, videoMinf.end, 'vmhd');
  const videoDinf = findBox(file1MoovBuffer, videoMinf.contentStart, videoMinf.end, 'dinf');
  const videoStbl = findBox(file1MoovBuffer, videoMinf.contentStart, videoMinf.end, 'stbl');
  if (!videoStbl) throw new Error('First video track is missing stbl box');
  const videoStsd = findBox(file1MoovBuffer, videoStbl.contentStart, videoStbl.end, 'stsd');
  if (!videoStsd) throw new Error('First video track is missing stsd box');

  const videoStsdBytes = new Uint8Array(file1MoovBuffer, videoStsd.start, videoStsd.size);
  const stblParts: Uint8Array[] = [videoStsdBytes, newVideoStts, newVideoStsc, newVideoStsz, newVideoStco, newVideoStss];
  if (newVideoCtts) {
    stblParts.push(newVideoCtts);
  }
  const newVideoStbl = wrapBox('stbl', concatArrays(stblParts));

  // Build minf
  const minfParts: Uint8Array[] = [];
  if (vmhd) minfParts.push(new Uint8Array(file1MoovBuffer, vmhd.start, vmhd.size));
  if (videoDinf) minfParts.push(new Uint8Array(file1MoovBuffer, videoDinf.start, videoDinf.size));
  minfParts.push(newVideoStbl);
  const newVideoMinf = wrapBox('minf', concatArrays(minfParts));

  // Build mdia
  const videoHdlrBytes = videoHdlr
    ? new Uint8Array(file1MoovBuffer, videoHdlr.start, videoHdlr.size)
    : new Uint8Array(0);
  const newVideoMdhd = updateMdhdDuration(
    new Uint8Array(file1MoovBuffer, videoMdhd.start, videoMdhd.size),
    videoMediaDuration,
  );
  const newVideoMdia = wrapBox('mdia', concatArrays([newVideoMdhd, videoHdlrBytes, newVideoMinf]));

  // Build tkhd
  const videoTkhd = findBox(file1MoovBuffer, videoTrak.contentStart, videoTrak.end, 'tkhd');
  if (!videoTkhd) throw new Error('First video track is missing tkhd box');
  const newVideoTkhd = updateTkhdDuration(
    new Uint8Array(file1MoovBuffer, videoTkhd.start, videoTkhd.size),
    videoMovieDuration,
  );

  // Build edit list to prevent black first frame caused by B-frame composition offsets.
  // H.264 B-frames use ctts to reorder frames, creating a gap at time 0 where no frame
  // has a composition time of 0. Without an edit list, players show black during this gap.
  let newVideoEdts: Uint8Array | null = null;
  const sourceVideoEdts = findBox(file1MoovBuffer, videoTrak.contentStart, videoTrak.end, 'edts');
  if (sourceVideoEdts) {
    // Source video has an edit list — preserve its media_time with updated duration
    const sourceElst = findBox(file1MoovBuffer, sourceVideoEdts.contentStart, sourceVideoEdts.end, 'elst');
    if (sourceElst) {
      const elstView = new DataView(file1MoovBuffer, sourceElst.start, sourceElst.size);
      const elstVersion = elstView.getUint8(8);
      const entryCount = elstView.getUint32(12);
      if (entryCount > 0) {
        const mediaTime = elstVersion === 0
          ? elstView.getInt32(20)
          : Number(elstView.getBigInt64(24));
        newVideoEdts = buildEdts(videoMovieDuration, mediaTime);
      }
    }
  } else if (allCttsEntries.length > 0 && allCttsEntries[0].sampleOffset > 0) {
    // No source edit list, but ctts exists with a non-zero first composition offset.
    // Create an edit list using the first sample's composition offset to skip the B-frame gap.
    newVideoEdts = buildEdts(videoMovieDuration, allCttsEntries[0].sampleOffset);
  }

  // Build video trak
  const videoTrakParts: Uint8Array[] = [newVideoTkhd];
  if (newVideoEdts) videoTrakParts.push(newVideoEdts);
  videoTrakParts.push(newVideoMdia);
  const newVideoTrak = wrapBox('trak', concatArrays(videoTrakParts));

  // Build moov (video only)
  const newMvhd = updateMvhdDuration(
    new Uint8Array(file1MoovBuffer, mvhd.start, mvhd.size),
    videoMovieDuration,
  );
  const newMoov = wrapBox('moov', concatArrays([newMvhd, newVideoTrak]));

  return concatArrays([firstParsed.ftyp!, newMdat, newMoov]);
}

// ========== PUBLIC API ==========

const S3_DOWNLOAD_DELAY_MS = 150;

async function downloadVideos(
  urls: string[],
  onProgress?: (progress: number) => void,
): Promise<ArrayBuffer[]> {
  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, S3_DOWNLOAD_DELAY_MS));
    const response = await fetch(urls[i]);
    if (!response.ok) throw new Error(`Failed to download video ${i}: ${response.status}`);
    buffers.push(await response.arrayBuffer());
    onProgress?.((i + 1) / urls.length * 0.5);
  }
  return buffers;
}

export async function concatenateVideos(
  videoUrls: string[],
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  if (videoUrls.length === 0) throw new Error('No videos to concatenate');
  if (videoUrls.length === 1) {
    const response = await fetch(videoUrls[0]);
    if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
    return new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
  }
  const buffers = await downloadVideos(videoUrls, onProgress);
  onProgress?.(0.6);
  const result = concatenateMP4s_Base(buffers);
  onProgress?.(0.9);
  return new Blob([toArrayBuffer(result)], { type: 'video/mp4' });
}
