// Minimal store-only (uncompressed) ZIP writer. No dependencies, no DOM.

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/**
 * CRC-32 (IEEE) of a byte array.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit
 */
export function crc32(bytes) {
  const table = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Build a ZIP archive (method 0 = stored).
 * @param {Array<{name: string, data: string|Uint8Array}>} files
 * @param {Date} [now]
 * @returns {Uint8Array}
 */
export function createZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
  const u32 = n => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
  const push = (arr, ...parts) => parts.forEach(p => arr.push(p));
  const len = parts => parts.reduce((s, p) => s + p.length, 0);

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const flags = 0x0800; // UTF-8 file names

    const local = [
      u32(0x04034B50), u16(20), u16(flags), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0),
      nameBytes,
    ];
    push(chunks, ...local, data);

    const cd = [
      u32(0x02014B50), u16(20), u16(20), u16(flags), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
      nameBytes,
    ];
    central.push(cd);

    offset += len(local) + data.length;
  }

  const centralSize = central.reduce((s, cd) => s + len(cd), 0);
  const centralChunks = central.flat();
  const eocd = [
    u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0),
  ];

  const total = offset + centralSize + len(eocd);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...chunks, ...centralChunks, ...eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
