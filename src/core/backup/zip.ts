export type ZipEntry = {
  path: string;
  data: Uint8Array | string | Blob;
  mimeType?: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function entryBytes(data: ZipEntry['data']): Promise<Uint8Array> {
  if (typeof data === 'string') return textEncoder.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await data.arrayBuffer());
}

export async function createZip(entries: ZipEntry[]): Promise<Blob> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = textEncoder.encode(entry.path.replace(/\\/g, '/'));
    const data = await entryBytes(entry.data);
    const crc = crc32(data);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.byteLength),
      u32(data.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    centralParts.push(concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.byteLength),
      u32(data.byteLength),
      u16(name.byteLength),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += localHeader.byteLength + data.byteLength;
  }

  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
  const zipBytes = concat([...localParts, central, end]);
  return new Blob([arrayBufferOf(zipBytes)], {
    type: 'application/zip',
  });
}

export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= 0; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP_EOCD_NOT_FOUND');
  const entries = readU16(bytes, eocd + 10);
  let cursor = readU32(bytes, eocd + 16);
  const out = new Map<string, Blob>();

  for (let i = 0; i < entries; i++) {
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('ZIP_CENTRAL_DIRECTORY_INVALID');
    const method = readU16(bytes, cursor + 10);
    if (method !== 0) throw new Error('ZIP_UNSUPPORTED_COMPRESSION');
    const compressedSize = readU32(bytes, cursor + 20);
    const fileNameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = textDecoder.decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));
    if (readU32(bytes, localOffset) !== 0x04034b50) throw new Error('ZIP_LOCAL_HEADER_INVALID');
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(start, start + compressedSize);
    out.set(name, new Blob([arrayBufferOf(data)]));
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return out;
}
