import { inflateSync } from "fflate";

/**
 * Decryption support for password protected ETS projects.
 *
 * A protected `.knxproj` contains the project folder as an encrypted inner
 * archive (`P-XXXX.zip`). Depending on the ETS version it uses:
 *  - ETS4 / ETS5: traditional PKWARE "ZipCrypto" with the plain password
 *  - ETS6:        WinZip AES (method 99) with a password derived via
 *                 PBKDF2-HMAC-SHA256(utf16le(password), "21.project.ets.knx.org", 65536)
 *
 * Everything runs locally (browser / web worker); the password never leaves the device.
 */

export type KnxPasswordErrorCode = "PASSWORD_REQUIRED" | "PASSWORD_INVALID";

export class KnxPasswordError extends Error {
  readonly code: KnxPasswordErrorCode;
  constructor(code: KnxPasswordErrorCode, message?: string) {
    super(
      message ??
        (code === "PASSWORD_REQUIRED"
          ? "This project is password protected. Please enter the project password."
          : "Invalid project password.")
    );
    this.name = "KnxPasswordError";
    this.code = code;
  }
}

export function isKnxPasswordError(err: unknown): err is KnxPasswordError {
  return err instanceof KnxPasswordError;
}

/** ====================== CRC32 ====================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ====================== AES (encrypt only, for CTR keystream) ====================== */

const SBOX = new Uint8Array(256);
const T0 = new Uint32Array(256);
const T1 = new Uint32Array(256);
const T2 = new Uint32Array(256);
const T3 = new Uint32Array(256);

(() => {
  // Build S-box and T-tables (FIPS-197) using exp/log tables over GF(2^8) with generator 3.
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = v;
    log[v] = i;
    v ^= (v << 1) ^ (v & 0x80 ? 0x11b : 0); // v *= 3
    v &= 0xff;
  }
  const mul2 = (a: number) => ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
  for (let x = 0; x < 256; x++) {
    const inv = x === 0 ? 0 : exp[(255 - log[x]) % 255];
    let s = inv;
    for (let r = 1; r <= 4; r++) s ^= ((inv << r) | (inv >>> (8 - r))) & 0xff;
    s ^= 0x63;
    SBOX[x] = s;
    const s2 = mul2(s);
    const t = ((s2 << 24) | (s << 16) | (s << 8) | (s2 ^ s)) >>> 0;
    T0[x] = t;
    T1[x] = ((t << 24) | (t >>> 8)) >>> 0;
    T2[x] = ((t << 16) | (t >>> 16)) >>> 0;
    T3[x] = ((t << 8) | (t >>> 24)) >>> 0;
  }
})();

class AesEncryptor {
  private readonly rk: Uint32Array;
  private readonly rounds: number;

  constructor(key: Uint8Array) {
    const nk = key.length / 4;
    if (nk !== 4 && nk !== 6 && nk !== 8) throw new Error("Invalid AES key length");
    this.rounds = nk + 6;
    const total = 4 * (this.rounds + 1);
    const rk = new Uint32Array(total);
    for (let i = 0; i < nk; i++) {
      rk[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
    }
    let rcon = 1;
    for (let i = nk; i < total; i++) {
      let t = rk[i - 1];
      if (i % nk === 0) {
        t =
          ((SBOX[(t >>> 16) & 0xff] << 24) |
            (SBOX[(t >>> 8) & 0xff] << 16) |
            (SBOX[t & 0xff] << 8) |
            SBOX[t >>> 24]) ^
          (rcon << 24);
        rcon = rcon & 0x80 ? ((rcon << 1) ^ 0x11b) & 0xff : rcon << 1;
      } else if (nk > 6 && i % nk === 4) {
        t =
          (SBOX[t >>> 24] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff];
      }
      rk[i] = (rk[i - nk] ^ t) >>> 0;
    }
    this.rk = rk;
  }

  /** Encrypts one 16 byte block given as four big-endian words; writes 16 bytes to out[offset]. */
  encryptWords(w0: number, w1: number, w2: number, w3: number, out: Uint8Array, offset: number) {
    const rk = this.rk;
    let s0 = w0 ^ rk[0];
    let s1 = w1 ^ rk[1];
    let s2 = w2 ^ rk[2];
    let s3 = w3 ^ rk[3];
    let k = 4;
    for (let r = 1; r < this.rounds; r++) {
      const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xff] ^ T2[(s2 >>> 8) & 0xff] ^ T3[s3 & 0xff] ^ rk[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xff] ^ T2[(s3 >>> 8) & 0xff] ^ T3[s0 & 0xff] ^ rk[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xff] ^ T2[(s0 >>> 8) & 0xff] ^ T3[s1 & 0xff] ^ rk[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xff] ^ T2[(s1 >>> 8) & 0xff] ^ T3[s2 & 0xff] ^ rk[k + 3];
      s0 = t0;
      s1 = t1;
      s2 = t2;
      s3 = t3;
      k += 4;
    }
    const words = [s0, s1, s2, s3];
    for (let i = 0; i < 4; i++) {
      const a = words[i];
      const b = words[(i + 1) & 3];
      const c = words[(i + 2) & 3];
      const d = words[(i + 3) & 3];
      const v =
        ((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 0xff] << 16) | (SBOX[(c >>> 8) & 0xff] << 8) | SBOX[d & 0xff]) ^
        rk[k + i];
      out[offset + 4 * i] = v >>> 24;
      out[offset + 4 * i + 1] = (v >>> 16) & 0xff;
      out[offset + 4 * i + 2] = (v >>> 8) & 0xff;
      out[offset + 4 * i + 3] = v & 0xff;
    }
  }

  encryptBlock(block: Uint8Array): Uint8Array {
    const dv = new DataView(block.buffer, block.byteOffset, 16);
    const out = new Uint8Array(16);
    this.encryptWords(dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12), out, 0);
    return out;
  }
}

/** Exposed for tests only. */
export function aesEncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  return new AesEncryptor(key).encryptBlock(block);
}

/**
 * WinZip AES uses CTR mode with a 128-bit little-endian counter starting at 1
 * (which is why Web Crypto's big-endian AES-CTR cannot be used directly).
 */
function winzipAesCtr(key: Uint8Array, data: Uint8Array): Uint8Array {
  const aes = new AesEncryptor(key);
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  let counter = 0; // low 32 bits are sufficient for < 64 GiB of data
  for (let pos = 0; pos < data.length; pos += 16) {
    counter = (counter + 1) >>> 0;
    // little-endian counter in byte 0..3 -> big-endian word 0 is the byte-swapped counter
    const w0 =
      (((counter & 0xff) << 24) | (((counter >>> 8) & 0xff) << 16) | (((counter >>> 16) & 0xff) << 8) | (counter >>> 24)) >>>
      0;
    aes.encryptWords(w0, 0, 0, 0, ks, 0);
    const end = Math.min(16, data.length - pos);
    for (let i = 0; i < end; i++) out[pos + i] = data[pos + i] ^ ks[i];
  }
  return out;
}

/** ====================== WEB CRYPTO HELPERS ====================== */

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto API is not available in this environment.");
  return subtle;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  bytes: number,
  hash: "SHA-1" | "SHA-256"
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await subtle.importKey("raw", toArrayBuffer(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash },
    key,
    bytes * 8
  );
  return new Uint8Array(bits);
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  const k = await subtle.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, toArrayBuffer(data)));
}

function encodeUtf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >>> 8;
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

/** Password used by ETS6 for the inner project archive. */
export async function deriveEts6ZipPassword(password: string): Promise<string> {
  const derived = await pbkdf2(
    encodeUtf16le(password),
    new TextEncoder().encode("21.project.ets.knx.org"),
    65536,
    32,
    "SHA-256"
  );
  return base64(derived);
}

/** ====================== ZIP STRUCTURE ====================== */

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  extra: Uint8Array;
}

function readCentralDirectory(zip: Uint8Array): CentralEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Protected project archive is not a valid ZIP file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt central directory in project archive.");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const extra = zip.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("ZIP64 project archives are not supported.");
    }
    entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localHeaderOffset, extra });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entryData(zip: Uint8Array, e: CentralEntry): Uint8Array {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const p = e.localHeaderOffset;
  if (dv.getUint32(p, true) !== 0x04034b50) throw new Error("Corrupt local header in project archive.");
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  return zip.subarray(start, start + e.compressedSize);
}

function findAesExtra(extra: Uint8Array): { strength: number; method: number; version: number } | null {
  const dv = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = dv.getUint16(p, true);
    const size = dv.getUint16(p + 2, true);
    if (id === 0x9901 && size >= 7) {
      return {
        version: dv.getUint16(p + 4, true),
        strength: extra[p + 8],
        method: dv.getUint16(p + 9, true),
      };
    }
    p += 4 + size;
  }
  return null;
}

function decompress(method: number, data: Uint8Array, expectedSize: number): Uint8Array {
  if (method === 0) return data;
  if (method === 8) return inflateSync(data, { out: new Uint8Array(expectedSize) });
  throw new Error(`Unsupported compression method ${method} in project archive.`);
}

/** ====================== ZIPCRYPTO (ETS4/5) ====================== */

function zipCryptoDecrypt(password: Uint8Array, data: Uint8Array, checkByte: number): Uint8Array | null {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (c: number) => {
    k0 = CRC_TABLE[(k0 ^ c) & 0xff] ^ (k0 >>> 8);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = CRC_TABLE[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8);
  };
  for (let i = 0; i < password.length; i++) update(password[i]);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    update(c);
    out[i] = c;
  }
  if (out.length < 12 || out[11] !== checkByte) return null;
  return out.subarray(12);
}

/** ====================== WINZIP AES (ETS6) ====================== */

const AES_KEY_LEN: Record<number, number> = { 1: 16, 2: 24, 3: 32 };

async function winzipAesDecrypt(
  password: Uint8Array,
  data: Uint8Array,
  strength: number
): Promise<Uint8Array | null> {
  const keyLen = AES_KEY_LEN[strength];
  if (!keyLen) throw new Error("Unsupported AES strength in project archive.");
  const saltLen = keyLen / 2;
  if (data.length < saltLen + 2 + 10) return null;
  const salt = data.subarray(0, saltLen);
  const verifier = data.subarray(saltLen, saltLen + 2);
  const cipher = data.subarray(saltLen + 2, data.length - 10);
  const authCode = data.subarray(data.length - 10);

  const derived = await pbkdf2(password, salt, 1000, 2 * keyLen + 2, "SHA-1");
  if (derived[2 * keyLen] !== verifier[0] || derived[2 * keyLen + 1] !== verifier[1]) return null;

  const mac = await hmacSha1(derived.subarray(keyLen, 2 * keyLen), cipher);
  for (let i = 0; i < 10; i++) if (mac[i] !== authCode[i]) return null;

  return winzipAesCtr(derived.subarray(0, keyLen), cipher);
}

/** ====================== PUBLIC API ====================== */

export function isZipEncrypted(zip: Uint8Array): boolean {
  try {
    return readCentralDirectory(zip).some((e) => (e.flags & 1) === 1);
  } catch {
    return false;
  }
}

async function tryExtract(
  zip: Uint8Array,
  entries: CentralEntry[],
  password: Uint8Array,
  filter?: (name: string) => boolean
): Promise<Record<string, Uint8Array> | null> {
  const out: Record<string, Uint8Array> = {};
  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    if (filter && !filter(e.name)) continue;
    const raw = entryData(zip, e);
    let plain: Uint8Array;
    let method = e.method;
    let checkCrc = true;

    if ((e.flags & 1) === 0) {
      plain = raw;
    } else if (e.method === 99) {
      const aes = findAesExtra(e.extra);
      if (!aes) throw new Error("Missing AES header in project archive.");
      const dec = await winzipAesDecrypt(password, raw, aes.strength);
      if (!dec) return null;
      plain = dec;
      method = aes.method;
      checkCrc = aes.version === 1; // AE-2 stores no CRC
    } else {
      // Traditional encryption: check byte is the high byte of the CRC, or of the
      // DOS mod time when a data descriptor is used (bit 3).
      const checkByte = e.flags & 0x08 ? (getModTime(zip, e) >>> 8) & 0xff : e.crc >>> 24;
      const dec = zipCryptoDecrypt(password, raw, checkByte);
      if (!dec) return null;
      plain = dec;
    }

    let content: Uint8Array;
    try {
      content = decompress(method, plain, e.uncompressedSize);
    } catch {
      // ZipCrypto only has an 8-bit check, a wrong password can slip through it.
      if ((e.flags & 1) === 1 && e.method !== 99) return null;
      throw new Error(`Could not decompress ${e.name} in project archive.`);
    }
    if (checkCrc && crc32(content) !== e.crc) {
      if ((e.flags & 1) === 1) return null;
      throw new Error(`CRC mismatch for ${e.name} in project archive.`);
    }
    out[e.name] = content;
  }
  return out;
}

function getModTime(zip: Uint8Array, e: CentralEntry): number {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return dv.getUint16(e.localHeaderOffset + 10, true);
}

/**
 * Extracts the (possibly encrypted) inner project archive of a protected ETS project.
 * Tries the ETS6 derived password first, then the plain password (ETS4/5).
 */
export async function extractProtectedProject(
  zip: Uint8Array,
  password: string | undefined,
  filter?: (name: string) => boolean
): Promise<Record<string, Uint8Array>> {
  const entries = readCentralDirectory(zip);
  const encrypted = entries.some((e) => (e.flags & 1) === 1);

  if (!encrypted) {
    const res = await tryExtract(zip, entries, new Uint8Array(0), filter);
    if (res) return res;
  }
  if (!password) throw new KnxPasswordError("PASSWORD_REQUIRED");

  const usesAes = entries.some((e) => (e.flags & 1) === 1 && e.method === 99);
  const enc = new TextEncoder();
  const plain = enc.encode(password);
  const candidates = usesAes
    ? [enc.encode(await deriveEts6ZipPassword(password)), plain]
    : [plain, enc.encode(await deriveEts6ZipPassword(password))];

  for (const candidate of candidates) {
    const res = await tryExtract(zip, entries, candidate, filter);
    if (res) return res;
  }
  throw new KnxPasswordError("PASSWORD_INVALID");
}
