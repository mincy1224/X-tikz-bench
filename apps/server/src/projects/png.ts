export const MAX_PNG_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_PNG_BYTES = 50 * 1024 * 1024;
export const PNG_KEY = /^[0-9a-f]{64}\.png$/u;
export const ASSET_KEY = /^[0-9a-f]{64}\.(?:png|pdf)$/u;
export type ProjectAsset = { key: string; name: string; width: number; height: number };

// PNG uses the reflected CRC-32 polynomial. The server also runs on Node 18.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 45 || bytes.length > MAX_PNG_BYTES || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("无效或过大的 PNG 文件。");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 16_384 || height > 16_384 || width * height > 40_000_000) throw new Error("PNG 像素尺寸超出限制。");
  let imageData = false;
  for (let start = 8; start + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(start);
    const end = start + 8 + length;
    if (end + 4 > bytes.length || crc32(bytes.subarray(start + 4, end)) !== bytes.readUInt32BE(end)) break;
    const kind = bytes.toString("ascii", start + 4, start + 8);
    if (kind === "IDAT" && length > 0) imageData = true;
    if (kind === "IEND" && length === 0 && imageData && end + 4 === bytes.length) return { width, height };
    start = end + 4;
  }
  throw new Error("PNG 文件损坏或不完整。");
}

export function referencedPngKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.replace(/(?<!\\)%[^\r\n]*/gu, "").matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{\s*assets\/([0-9a-f]{64}\.(?:png|pdf))\s*\}/gu)) keys.add(match[1]);
  return [...keys];
}
