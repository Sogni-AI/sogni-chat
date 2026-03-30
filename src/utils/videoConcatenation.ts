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
 *
 * Also handles:
 * - Audio track concatenation when ALL source videos contain audio
 *
 * Does NOT handle (can be added later):
 * - Frame extraction
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

interface AudioTrackInfo {
  stsdBox: Uint8Array | null;
  sampleSizes: number[];
  sampleDelta: number;
  timescale: number;
  duration: number;
  mdatData: Uint8Array;
}

interface TrimmedAudio {
  sampleSizes: number[];
  mdatData: Uint8Array;
  duration: number;
  timescale: number;
  sampleDelta: number;
  stsdBox: Uint8Array | null;
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
 * Uses handler type detection to skip non-video traks (e.g., metadata, timecode)
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

/**
 * Find audio trak in moov (handler type 'soun')
 * Uses handler type detection to locate the sound track.
 */
function findAudioTrak(buffer: ArrayBuffer): BoxInfo | null {
  const view = new DataView(buffer);
  let offset = 8; // Skip moov header

  while (offset < buffer.byteLength - 8) {
    const size = view.getUint32(offset);
    const type = getBoxType(view, offset + 4);

    if (size === 0 || offset + size > buffer.byteLength) break;

    if (type === 'trak') {
      // Check if this is an audio track by looking at hdlr
      const hdlr = findNestedBoxInRange(buffer, offset + 8, offset + size, ['mdia', 'hdlr']);
      if (hdlr) {
        const hdlrView = new DataView(buffer, hdlr.start, hdlr.size);
        // Handler type is at offset 16 (after header + version/flags + pre_defined)
        const handlerType = getBoxType(hdlrView, 16);
        if (handlerType === 'soun') {
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
 * Core MP4 concatenation engine (video track only).
 *
 * Parses each input buffer, extracts video samples from mdat using
 * stco/stsc/stsz, collects ctts entries for B-frame support, concatenates all
 * samples into a single mdat, rebuilds moov with combined sample tables,
 * and returns a complete MP4.
 */
function concatenateMP4s_Base(buffers: ArrayBuffer[], skipAudio = false): Uint8Array {
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

  // ========== Audio detection ==========
  // Check if ALL source files have audio tracks (handler type 'soun').
  // We only include audio in the output when every source has it.
  const firstAudioTrak = skipAudio ? null : findAudioTrak(file1MoovBuffer);
  let allFilesHaveAudio = !!firstAudioTrak;
  if (allFilesHaveAudio) {
    for (let fileIdx = 1; fileIdx < parsedFiles.length; fileIdx++) {
      const moovBuf = toArrayBuffer(parsedFiles[fileIdx].moov!);
      if (!findAudioTrak(moovBuf)) {
        allFilesHaveAudio = false;
        break;
      }
    }
  }

  // ========== Audio timing extraction (from first file) ==========
  let audioTimescale = 44100;
  let audioSampleDelta = 1024;

  if (allFilesHaveAudio && firstAudioTrak) {
    const audioMdiaBox = findBox(file1MoovBuffer, firstAudioTrak.contentStart, firstAudioTrak.end, 'mdia');
    if (audioMdiaBox) {
      const audioMdhdBox = findBox(file1MoovBuffer, audioMdiaBox.contentStart, audioMdiaBox.end, 'mdhd');
      if (audioMdhdBox) {
        const aMdhdView = new DataView(file1MoovBuffer, audioMdhdBox.start, audioMdhdBox.size);
        audioTimescale = aMdhdView.getUint8(8) === 0 ? aMdhdView.getUint32(20) : aMdhdView.getUint32(28);
      }
      const audioMinfBox = findBox(file1MoovBuffer, audioMdiaBox.contentStart, audioMdiaBox.end, 'minf');
      if (audioMinfBox) {
        const audioStblBox = findBox(file1MoovBuffer, audioMinfBox.contentStart, audioMinfBox.end, 'stbl');
        if (audioStblBox) {
          const audioSttsBox = findBox(file1MoovBuffer, audioStblBox.contentStart, audioStblBox.end, 'stts');
          if (audioSttsBox) {
            const aSttsView = new DataView(file1MoovBuffer, audioSttsBox.start, audioSttsBox.size);
            if (aSttsView.getUint32(12) > 0) {
              audioSampleDelta = aSttsView.getUint32(20);
            }
          }
        }
      }
    }
  }

  // ========== Audio sample extraction ==========
  const allAudioSizes: number[] = [];
  const allAudioSamples: Uint8Array[] = [];

  if (allFilesHaveAudio) {
    for (let fileIdx = 0; fileIdx < parsedFiles.length; fileIdx++) {
      const p = parsedFiles[fileIdx];
      const moovBuf = toArrayBuffer(p.moov!);
      const origBuf = new Uint8Array(buffers[fileIdx]);

      const aTrak = findAudioTrak(moovBuf);
      if (!aTrak) continue;

      const aStbl = findNestedBoxInRange(moovBuf, aTrak.contentStart, aTrak.end, ['mdia', 'minf', 'stbl']);
      if (!aStbl) continue;
      const aStsz = findBox(moovBuf, aStbl.contentStart, aStbl.end, 'stsz');
      const aStco = findBox(moovBuf, aStbl.contentStart, aStbl.end, 'stco');
      const aStsc = findBox(moovBuf, aStbl.contentStart, aStbl.end, 'stsc');
      if (!aStsz || !aStco) continue;

      const aStszView = new DataView(moovBuf, aStsz.start, aStsz.size);
      const aStcoView = new DataView(moovBuf, aStco.start, aStco.size);
      const aSampleCount = aStszView.getUint32(16);
      const aChunkCount = aStcoView.getUint32(12);

      // Handle uniform stsz (offset 12 = uniformSize; when != 0 all samples share that size)
      const aUniformSize = aStszView.getUint32(12);
      const aSampleSizes: number[] = [];
      if (aUniformSize !== 0) {
        for (let i = 0; i < aSampleCount; i++) aSampleSizes.push(aUniformSize);
      } else {
        for (let i = 0; i < aSampleCount; i++) aSampleSizes.push(aStszView.getUint32(20 + i * 4));
      }

      const aChunkOffsets: number[] = [];
      for (let i = 0; i < aChunkCount; i++) aChunkOffsets.push(aStcoView.getUint32(16 + i * 4));

      const aStscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
      if (aStsc) {
        const aStscView = new DataView(moovBuf, aStsc.start, aStsc.size);
        const entryCount = aStscView.getUint32(12);
        for (let i = 0; i < entryCount; i++) {
          aStscEntries.push({
            firstChunk: aStscView.getUint32(16 + i * 12),
            samplesPerChunk: aStscView.getUint32(20 + i * 12),
          });
        }
      }

      let aSampleIdx = 0;
      for (let chunkIdx = 0; chunkIdx < aChunkCount && aSampleIdx < aSampleCount; chunkIdx++) {
        let samplesInChunk = 1;
        for (const entry of aStscEntries) {
          if (entry.firstChunk <= chunkIdx + 1) samplesInChunk = entry.samplesPerChunk;
        }
        let byteOffset = aChunkOffsets[chunkIdx];
        for (let s = 0; s < samplesInChunk && aSampleIdx < aSampleCount; s++) {
          const sampleSize = aSampleSizes[aSampleIdx];
          if (byteOffset + sampleSize <= origBuf.length) {
            allAudioSamples.push(origBuf.slice(byteOffset, byteOffset + sampleSize));
            allAudioSizes.push(sampleSize);
          }
          byteOffset += sampleSize;
          aSampleIdx++;
        }
      }
    }
  }

  // Disable audio if extraction yielded nothing usable (0 samples, or broken timing)
  const hasAudio = allAudioSizes.length > 0 && audioTimescale > 0 && audioSampleDelta > 0;

  // ========== Build combined mdat ==========
  const combinedVideoData = concatArrays(allVideoSamples);
  let newMdat: Uint8Array;
  if (hasAudio) {
    const combinedAudioData = concatArrays(allAudioSamples);
    newMdat = buildMdat(concatArrays([combinedVideoData, combinedAudioData]));
  } else {
    newMdat = buildMdat(combinedVideoData);
  }

  // Calculate durations
  const videoMediaDuration = allVideoSizes.length * firstTables.sampleDelta;
  const videoMovieDuration = Math.round(videoMediaDuration * movieTimescale / videoTimescale);

  // Audio durations (used for audio trak and overall movie duration)
  const audioMediaDuration = hasAudio ? allAudioSizes.length * audioSampleDelta : 0;
  const audioMovieDuration = hasAudio ? Math.round(audioMediaDuration * movieTimescale / audioTimescale) : 0;

  // Single chunk for simplicity
  const ftypSize = firstParsed.ftyp!.byteLength;
  const videoChunkOffsets = [ftypSize + 8]; // After ftyp + mdat header
  // Audio data starts after video data in the combined mdat
  const audioChunkOffset = ftypSize + 8 + combinedVideoData.byteLength;

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

  // ========== Build audio trak (when all sources have audio) ==========
  let newAudioTrak: Uint8Array | null = null;
  if (hasAudio && firstAudioTrak) {
    const audioMdia = findBox(file1MoovBuffer, firstAudioTrak.contentStart, firstAudioTrak.end, 'mdia');
    if (audioMdia) {
      const audioMdhd = findBox(file1MoovBuffer, audioMdia.contentStart, audioMdia.end, 'mdhd');
      const audioHdlr = findBox(file1MoovBuffer, audioMdia.contentStart, audioMdia.end, 'hdlr');
      const audioMinf = findBox(file1MoovBuffer, audioMdia.contentStart, audioMdia.end, 'minf');

      if (audioMdhd && audioMinf) {
        const smhd = findBox(file1MoovBuffer, audioMinf.contentStart, audioMinf.end, 'smhd');
        const audioDinf = findBox(file1MoovBuffer, audioMinf.contentStart, audioMinf.end, 'dinf');
        const audioStblBox = findBox(file1MoovBuffer, audioMinf.contentStart, audioMinf.end, 'stbl');

        if (audioStblBox) {
          const audioStsd = findBox(file1MoovBuffer, audioStblBox.contentStart, audioStblBox.end, 'stsd');

          if (audioStsd) {
            // Build new audio sample tables
            const newAudioStsz = buildStsz(allAudioSizes);
            const newAudioStco = buildStco([audioChunkOffset]);
            const newAudioStsc = buildStsc([{
              firstChunk: 1,
              samplesPerChunk: allAudioSizes.length,
              sampleDescriptionIndex: 1,
            }]);
            const newAudioStts = buildStts(allAudioSizes.length, audioSampleDelta);

            // Build audio stbl
            const audioStsdBytes = new Uint8Array(file1MoovBuffer, audioStsd.start, audioStsd.size);
            const newAudioStbl = wrapBox('stbl', concatArrays([
              audioStsdBytes, newAudioStts, newAudioStsc, newAudioStsz, newAudioStco,
            ]));

            // Build audio minf
            const audioMinfParts: Uint8Array[] = [];
            if (smhd) audioMinfParts.push(new Uint8Array(file1MoovBuffer, smhd.start, smhd.size));
            if (audioDinf) audioMinfParts.push(new Uint8Array(file1MoovBuffer, audioDinf.start, audioDinf.size));
            audioMinfParts.push(newAudioStbl);
            const newAudioMinf = wrapBox('minf', concatArrays(audioMinfParts));

            // Build audio mdia
            const audioHdlrBytes = audioHdlr
              ? new Uint8Array(file1MoovBuffer, audioHdlr.start, audioHdlr.size)
              : new Uint8Array(0);
            const newAudioMdhd = updateMdhdDuration(
              new Uint8Array(file1MoovBuffer, audioMdhd.start, audioMdhd.size),
              audioMediaDuration,
            );
            const newAudioMdia = wrapBox('mdia', concatArrays([newAudioMdhd, audioHdlrBytes, newAudioMinf]));

            // Build audio tkhd
            const audioTkhd = findBox(file1MoovBuffer, firstAudioTrak.contentStart, firstAudioTrak.end, 'tkhd');
            if (audioTkhd) {
              const newAudioTkhd = updateTkhdDuration(
                new Uint8Array(file1MoovBuffer, audioTkhd.start, audioTkhd.size),
                audioMovieDuration,
              );
              newAudioTrak = wrapBox('trak', concatArrays([newAudioTkhd, newAudioMdia]));
            }
          }
        }
      }
    }
  }

  // ========== Build moov ==========
  // Use the longer of video/audio for the overall movie duration
  const overallMovieDuration = hasAudio
    ? Math.max(videoMovieDuration, audioMovieDuration)
    : videoMovieDuration;

  const newMvhd = updateMvhdDuration(
    new Uint8Array(file1MoovBuffer, mvhd.start, mvhd.size),
    overallMovieDuration,
  );

  const moovParts: Uint8Array[] = [newMvhd, newVideoTrak];
  if (newAudioTrak) {
    moovParts.push(newAudioTrak);
  }
  const newMoov = wrapBox('moov', concatArrays(moovParts));

  return concatArrays([firstParsed.ftyp!, newMdat, newMoov]);
}

// ========== AUDIO MUXING ==========
// Ported from sogni-photobooth. Extracts audio from an external MP4 source
// (e.g. the original dance reference video) and muxes it onto a video-only
// concatenated result — preventing ugly gaps/stutter between clips.

function extractAudioSamplesFromMdat(
  fileBuffer: ArrayBuffer,
  chunkOffsets: number[],
  stscEntries: { firstChunk: number; samplesPerChunk: number }[],
  sampleSizes: number[],
): Uint8Array | null {
  if (chunkOffsets.length === 0 || sampleSizes.length === 0) return null;

  let totalSize = 0;
  for (const size of sampleSizes) totalSize += size;
  if (totalSize === 0) return null;

  const audioData = new Uint8Array(totalSize);
  const fileBuf = new Uint8Array(fileBuffer);
  let sampleIndex = 0;
  let writeOffset = 0;

  for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
    let samplesInChunk = 1;
    for (let i = stscEntries.length - 1; i >= 0; i--) {
      if (chunkIdx + 1 >= stscEntries[i].firstChunk) {
        samplesInChunk = stscEntries[i].samplesPerChunk;
        break;
      }
    }

    let readOffset = chunkOffsets[chunkIdx];
    for (let s = 0; s < samplesInChunk && sampleIndex < sampleSizes.length; s++) {
      const sampleSize = sampleSizes[sampleIndex];
      if (readOffset + sampleSize <= fileBuf.length) {
        audioData.set(fileBuf.slice(readOffset, readOffset + sampleSize), writeOffset);
        writeOffset += sampleSize;
      }
      readOffset += sampleSize;
      sampleIndex++;
    }
  }

  return writeOffset > 0 ? audioData.slice(0, writeOffset) : null;
}

function extractAudioTrackFromBuffer(buffer: ArrayBuffer): AudioTrackInfo | null {
  const parsed = parseMP4(buffer);
  if (!parsed.moov) return null;

  const moovBuffer = toArrayBuffer(parsed.moov);
  const trak = findAudioTrak(moovBuffer);
  if (!trak) return null;

  const stbl = findNestedBoxInRange(moovBuffer, trak.contentStart, trak.end, ['mdia', 'minf', 'stbl']);
  if (!stbl) return null;

  // Sample sizes
  const stsz = findBox(moovBuffer, stbl.contentStart, stbl.end, 'stsz');
  const sampleSizes: number[] = [];
  if (stsz) {
    const v = new DataView(moovBuffer, stsz.start, stsz.size);
    const uniformSize = v.getUint32(12);
    const count = v.getUint32(16);
    if (uniformSize === 0) {
      for (let i = 0; i < count; i++) sampleSizes.push(v.getUint32(20 + i * 4));
    } else {
      for (let i = 0; i < count; i++) sampleSizes.push(uniformSize);
    }
  }

  // Chunk offsets
  const stco = findBox(moovBuffer, stbl.contentStart, stbl.end, 'stco');
  const chunkOffsets: number[] = [];
  if (stco) {
    const v = new DataView(moovBuffer, stco.start, stco.size);
    const count = v.getUint32(12);
    for (let i = 0; i < count; i++) chunkOffsets.push(v.getUint32(16 + i * 4));
  }

  // Sample-to-chunk mapping
  const stsc = findBox(moovBuffer, stbl.contentStart, stbl.end, 'stsc');
  const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
  if (stsc) {
    const v = new DataView(moovBuffer, stsc.start, stsc.size);
    const count = v.getUint32(12);
    for (let i = 0; i < count; i++) {
      stscEntries.push({
        firstChunk: v.getUint32(16 + i * 12),
        samplesPerChunk: v.getUint32(20 + i * 12),
      });
    }
  }

  // Time-to-sample (for sample delta)
  const stts = findBox(moovBuffer, stbl.contentStart, stbl.end, 'stts');
  let sampleDelta = 1024; // AAC default
  if (stts) {
    const v = new DataView(moovBuffer, stts.start, stts.size);
    if (v.getUint32(12) > 0) sampleDelta = v.getUint32(20);
  }

  // Audio format descriptor
  const stsd = findBox(moovBuffer, stbl.contentStart, stbl.end, 'stsd');
  const stsdBox = stsd ? new Uint8Array(moovBuffer, stsd.start, stsd.size) : null;

  // Media header (timescale + duration)
  const mdhd = findNestedBoxInRange(moovBuffer, trak.contentStart, trak.end, ['mdia', 'mdhd']);
  let timescale = 44100;
  let duration = 0;
  if (mdhd) {
    const v = new DataView(moovBuffer, mdhd.start, mdhd.size);
    const version = v.getUint8(8);
    if (version === 0) {
      timescale = v.getUint32(20);
      duration = v.getUint32(24);
    } else {
      timescale = v.getUint32(28);
      duration = Number(v.getBigUint64(32));
    }
  }

  if (sampleSizes.length === 0 || chunkOffsets.length === 0) return null;

  const mdatData = extractAudioSamplesFromMdat(buffer, chunkOffsets, stscEntries, sampleSizes);
  if (!mdatData || mdatData.byteLength === 0) return null;

  return { stsdBox, sampleSizes, sampleDelta, timescale, duration, mdatData };
}

function trimAudioSamples(
  audioTrack: AudioTrackInfo,
  startOffsetUnits: number,
  videoDurationSeconds: number,
  audioTimescale: number,
): TrimmedAudio {
  const samplesNeeded = Math.ceil(videoDurationSeconds * audioTimescale / audioTrack.sampleDelta);
  const startSample = Math.floor(startOffsetUnits / audioTrack.sampleDelta);

  const totalSamples = audioTrack.sampleSizes.length;
  const endSample = Math.min(startSample + samplesNeeded, totalSamples);
  const actualStartSample = Math.min(startSample, Math.max(0, totalSamples - 1));

  const trimmedSampleSizes = audioTrack.sampleSizes.slice(actualStartSample, endSample);

  let byteStart = 0;
  for (let i = 0; i < actualStartSample; i++) byteStart += audioTrack.sampleSizes[i];

  let byteLength = 0;
  for (let i = actualStartSample; i < endSample; i++) byteLength += audioTrack.sampleSizes[i];

  const availableBytes = audioTrack.mdatData.byteLength - byteStart;
  const actualByteLength = Math.min(byteLength, Math.max(0, availableBytes));
  const trimmedMdatData = actualByteLength > 0
    ? new Uint8Array(audioTrack.mdatData.buffer, audioTrack.mdatData.byteOffset + byteStart, actualByteLength)
    : new Uint8Array(0);

  return {
    sampleSizes: trimmedSampleSizes,
    mdatData: trimmedMdatData,
    duration: trimmedSampleSizes.length * audioTrack.sampleDelta,
    timescale: audioTrack.timescale,
    sampleDelta: audioTrack.sampleDelta,
    stsdBox: audioTrack.stsdBox,
  };
}

function buildAudioTkhd(duration: number, trackId: number): Uint8Array {
  const size = 92;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x74; result[5] = 0x6B; result[6] = 0x68; result[7] = 0x64; // tkhd
  view.setUint32(8, 0x00000007); // flags: enabled, in movie, in preview
  view.setUint32(12, 0); view.setUint32(16, 0); // creation/modification time
  view.setUint32(20, trackId);
  view.setUint32(24, 0); // reserved
  view.setUint32(28, duration);
  view.setUint32(32, 0); view.setUint32(36, 0); // reserved
  view.setInt16(40, 0); view.setInt16(42, 0); // layer, alternate group
  view.setInt16(44, 0x0100); // volume 1.0 (audio)
  view.setInt16(46, 0); // reserved
  const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  for (let i = 0; i < 9; i++) view.setInt32(48 + i * 4, matrix[i]);
  view.setUint32(84, 0); view.setUint32(88, 0); // width/height (0 for audio)

  return result;
}

function buildAudioMdhd(duration: number, timescale: number): Uint8Array {
  const size = 32;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x6D; result[5] = 0x64; result[6] = 0x68; result[7] = 0x64; // mdhd
  view.setUint32(8, 0); // version 0, flags 0
  view.setUint32(12, 0); view.setUint32(16, 0); // creation/modification time
  view.setUint32(20, timescale);
  view.setUint32(24, duration);
  view.setUint16(28, 0x55C4); // language 'und'
  view.setUint16(30, 0);

  return result;
}

function buildAudioHdlr(): Uint8Array {
  const size = 37;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x68; result[5] = 0x64; result[6] = 0x6C; result[7] = 0x72; // hdlr
  view.setUint32(8, 0); view.setUint32(12, 0); // version/flags, pre-defined
  result[16] = 0x73; result[17] = 0x6F; result[18] = 0x75; result[19] = 0x6E; // 'soun'
  view.setUint32(20, 0); view.setUint32(24, 0); view.setUint32(28, 0); // reserved
  result[32] = 0x53; result[33] = 0x6F; result[34] = 0x75; result[35] = 0x6E; result[36] = 0x00; // "Soun\0"

  return result;
}

function buildSmhd(): Uint8Array {
  const size = 16;
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);

  view.setUint32(0, size);
  result[4] = 0x73; result[5] = 0x6D; result[6] = 0x68; result[7] = 0x64; // smhd
  view.setUint32(8, 0); // version/flags
  view.setInt16(12, 0); view.setInt16(14, 0); // balance, reserved

  return result;
}

function buildDinf(): Uint8Array {
  const url = new Uint8Array(12);
  const urlView = new DataView(url.buffer);
  urlView.setUint32(0, 12);
  urlView.setUint32(4, 0x75726C20); // 'url '
  urlView.setUint32(8, 1); // self-contained

  const dref = new Uint8Array(16 + url.length);
  const drefView = new DataView(dref.buffer);
  drefView.setUint32(0, 16 + url.length);
  drefView.setUint32(4, 0x64726566); // 'dref'
  drefView.setUint32(8, 0);
  drefView.setUint32(12, 1);
  dref.set(url, 16);

  const dinf = new Uint8Array(8 + dref.length);
  const dinfView = new DataView(dinf.buffer);
  dinfView.setUint32(0, 8 + dref.length);
  dinfView.setUint32(4, 0x64696E66); // 'dinf'
  dinf.set(dref, 8);

  return dinf;
}

function buildBasicAudioStsd(sampleRate: number): Uint8Array {
  const mp4aSize = 36;
  const stsdSize = 16 + mp4aSize;
  const result = new Uint8Array(stsdSize);
  const view = new DataView(result.buffer);

  view.setUint32(0, stsdSize);
  result[4] = 0x73; result[5] = 0x74; result[6] = 0x73; result[7] = 0x64; // stsd
  view.setUint32(8, 0);
  view.setUint32(12, 1);

  const o = 16;
  view.setUint32(o, mp4aSize);
  result[o + 4] = 0x6D; result[o + 5] = 0x70; result[o + 6] = 0x34; result[o + 7] = 0x61; // 'mp4a'
  view.setUint16(o + 16, 2); // stereo
  view.setUint16(o + 18, 16); // sample size
  view.setUint32(o + 24, sampleRate << 16); // fixed-point sample rate

  return result;
}

function buildAudioStbl(audioTrack: AudioTrackInfo, trimmed: TrimmedAudio, chunkOffset: number): Uint8Array {
  const stsd = audioTrack.stsdBox || buildBasicAudioStsd(trimmed.timescale);
  const stsz = buildStsz(trimmed.sampleSizes);
  const stco = buildStco([chunkOffset]);
  const stsc = buildStsc([{
    firstChunk: 1,
    samplesPerChunk: trimmed.sampleSizes.length,
    sampleDescriptionIndex: 1,
  }]);
  const stts = buildStts(trimmed.sampleSizes.length, trimmed.sampleDelta);
  return wrapBox('stbl', concatArrays([stsd, stsz, stco, stsc, stts]));
}

function buildAudioMinf(audioTrack: AudioTrackInfo, trimmed: TrimmedAudio, chunkOffset: number): Uint8Array {
  return wrapBox('minf', concatArrays([buildSmhd(), buildDinf(), buildAudioStbl(audioTrack, trimmed, chunkOffset)]));
}

function buildAudioMdia(audioTrack: AudioTrackInfo, trimmed: TrimmedAudio, chunkOffset: number): Uint8Array {
  return wrapBox('mdia', concatArrays([
    buildAudioMdhd(trimmed.duration, trimmed.timescale),
    buildAudioHdlr(),
    buildAudioMinf(audioTrack, trimmed, chunkOffset),
  ]));
}

function buildAudioTrakBox(
  audioTrack: AudioTrackInfo,
  trimmed: TrimmedAudio,
  chunkOffset: number,
  movieDuration: number,
): Uint8Array {
  return wrapBox('trak', concatArrays([
    buildAudioTkhd(movieDuration, 2),
    buildEdts(movieDuration, 0),
    buildAudioMdia(audioTrack, trimmed, chunkOffset),
  ]));
}

function rebuildMoovWithAudioTrak(videoMoov: Uint8Array, audioTrak: Uint8Array): Uint8Array {
  const moovBuffer = toArrayBuffer(videoMoov);
  const view = new DataView(moovBuffer);

  // Find end of last trak in original moov
  let lastTrakEnd = 8;
  let offset = 8;
  while (offset < moovBuffer.byteLength - 8) {
    const size = view.getUint32(offset);
    const type = getBoxType(view, offset + 4);
    if (size === 0 || offset + size > moovBuffer.byteLength) break;
    if (type === 'trak') lastTrakEnd = offset + size;
    offset += size;
  }

  // Insert audio trak after last existing trak
  const beforeAudio = new Uint8Array(moovBuffer, 8, lastTrakEnd - 8); // skip moov header
  const afterLastTrak = new Uint8Array(moovBuffer, lastTrakEnd, moovBuffer.byteLength - lastTrakEnd);

  return wrapBox('moov', concatArrays([beforeAudio, audioTrak, afterLastTrak]));
}

/**
 * Mux audio from an external MP4 source onto a video-only MP4.
 * Extracts the audio track from the source, trims it to match the video
 * duration (with optional start offset), and rebuilds the container.
 */
function muxAudioOntoVideo(videoData: Uint8Array, audioSourceBuffer: ArrayBuffer, startOffset = 0): Uint8Array {
  const audioTrack = extractAudioTrackFromBuffer(audioSourceBuffer);
  if (!audioTrack) {
    console.warn('[VIDEO CONCAT] No audio track found in source — returning video-only result');
    return videoData;
  }

  const videoBuffer = toArrayBuffer(videoData);
  const video = parseMP4(videoBuffer);
  if (!video.ftyp || !video.moov || !video.mdatData) {
    console.warn('[VIDEO CONCAT] Invalid video structure for audio muxing — returning as-is');
    return videoData;
  }

  // Get video duration
  const videoDurations = getOriginalDurations(video.moov);
  const videoTimescale = getMovieTimescaleFromMoov(video.moov) || 1000;
  const videoDurationSeconds = videoDurations.movieDuration / videoTimescale;

  // Trim audio to match video duration with offset
  const audioTimescale = audioTrack.timescale || 44100;
  const startOffsetUnits = Math.floor(startOffset * audioTimescale);
  const trimmed = trimAudioSamples(audioTrack, startOffsetUnits, videoDurationSeconds, audioTimescale);

  if (trimmed.sampleSizes.length === 0 || trimmed.mdatData.byteLength === 0) {
    console.warn('[VIDEO CONCAT] Audio trimming yielded no data — returning video-only result');
    return videoData;
  }

  console.log(
    `[VIDEO CONCAT] Muxing audio: video=${videoDurationSeconds.toFixed(1)}s, ` +
    `audio=${(trimmed.duration / trimmed.timescale).toFixed(1)}s, offset=${startOffset}s`,
  );

  // Build combined mdat: video data + audio data
  const combinedMdatData = concatArrays([video.mdatData, trimmed.mdatData]);
  const newMdat = buildMdat(combinedMdatData);

  // Audio chunk offset = ftyp + mdat header (8 bytes) + video data
  const audioChunkOffset = video.ftyp.byteLength + 8 + video.mdatData.byteLength;

  // Build audio trak and insert into moov
  const newAudioTrak = buildAudioTrakBox(audioTrack, trimmed, audioChunkOffset, videoDurations.movieDuration);
  const newMoov = rebuildMoovWithAudioTrak(video.moov, newAudioTrak);

  return concatArrays([video.ftyp, newMdat, newMoov]);
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

export interface AudioSourceOptions {
  /** Raw MP4 buffer containing the audio source (e.g. dance reference video) */
  buffer: ArrayBuffer;
  /** Start offset in seconds (default 0) */
  startOffset?: number;
}

export async function concatenateVideos(
  videoUrls: string[],
  onProgress?: (progress: number) => void,
  audioSource?: AudioSourceOptions,
): Promise<Blob> {
  if (videoUrls.length === 0) throw new Error('No videos to concatenate');
  if (videoUrls.length === 1 && !audioSource) {
    const response = await fetch(videoUrls[0]);
    if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
    return new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
  }
  const buffers = await downloadVideos(videoUrls, onProgress);
  onProgress?.(0.6);
  // When an external audio source is provided, strip individual clip audio
  // and mux the source audio over the result (prevents gaps between clips).
  const skipClipAudio = !!audioSource;
  let result = concatenateMP4s_Base(buffers, skipClipAudio);
  if (audioSource) {
    onProgress?.(0.75);
    result = muxAudioOntoVideo(result, audioSource.buffer, audioSource.startOffset ?? 0);
  }
  onProgress?.(0.9);
  return new Blob([toArrayBuffer(result)], { type: 'video/mp4' });
}
