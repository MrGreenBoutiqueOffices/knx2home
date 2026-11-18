import { describe, expect, it, beforeAll } from "@jest/globals";
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";
import { deflateSync, zipSync } from "fflate";

import { parseKnxproj } from "@/lib/knx/parse";
import {
  aesEncryptBlock,
  crc32,
  deriveEts6ZipPassword,
  extractProtectedProject,
  KnxPasswordError,
} from "@/lib/knx/zipDecrypt";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const te = new TextEncoder();

/** ---------- minimal ZIP writer with ZipCrypto / WinZip AES support (test only) ---------- */

type Encryption = "none" | "zipcrypto" | "aes";

interface ZipInput {
  name: string;
  content: Uint8Array;
}

function zipCryptoEncrypt(password: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (c: number) => {
    k0 = table[(k0 ^ c) & 0xff] ^ (k0 >>> 8);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = table[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8);
  };
  password.forEach(update);
  const header = new Uint8Array(randomBytes(12));
  header[11] = crc >>> 24;
  const plain = new Uint8Array(12 + data.length);
  plain.set(header);
  plain.set(data, 12);
  const out = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i++) {
    const t = (k2 | 2) & 0xffff;
    out[i] = plain[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    update(plain[i]);
  }
  return out;
}

function winzipAesEncrypt(password: Uint8Array, data: Uint8Array): Uint8Array {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(Buffer.from(password), salt, 1000, 66, "sha1");
  const encKey = derived.subarray(0, 32);
  const ecb = createCipheriv("aes-256-ecb", encKey, null);
  ecb.setAutoPadding(false);
  const cipher = new Uint8Array(data.length);
  for (let pos = 0, counter = 1; pos < data.length; pos += 16, counter++) {
    const block = Buffer.alloc(16);
    block.writeUInt32LE(counter, 0);
    const ks = ecb.update(block);
    for (let i = 0; i < 16 && pos + i < data.length; i++) cipher[pos + i] = data[pos + i] ^ ks[i];
  }
  const mac = createHmac("sha1", derived.subarray(32, 64)).update(cipher).digest().subarray(0, 10);
  return new Uint8Array(Buffer.concat([salt, derived.subarray(64, 66), cipher, mac]));
}

function buildZip(files: ZipInput[], password: string | null, encryption: Encryption): Uint8Array {
  const pw = te.encode(password ?? "");
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = te.encode(file.name);
    const crc = crc32(file.content);
    const compressed = deflateSync(file.content);
    let data: Uint8Array = compressed;
    let method = 8;
    let flags = 0;
    let extra = new Uint8Array(0);

    if (encryption === "zipcrypto") {
      flags = 1;
      data = zipCryptoEncrypt(pw, compressed, crc);
    } else if (encryption === "aes") {
      flags = 1;
      method = 99;
      data = winzipAesEncrypt(pw, compressed);
      extra = new Uint8Array([0x01, 0x99, 0x07, 0x00, 0x01, 0x00, 0x41, 0x45, 0x03, 0x08, 0x00]);
    }

    const local = new Uint8Array(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, file.content.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);

    const central = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, file.content.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    central.set(extra, 46 + name.length);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const projectXml = `<?xml version="1.0"?>
<KNX><Project Id="P-0001"><ProjectInformation Name="Secret House" />
  <GroupAddress Id="ga-1" Name="Kitchen Light" Address="2049" DatapointType="DPST-1-1" />
</Project></KNX>`;

const innerFiles: ZipInput[] = [
  { name: "0.xml", content: te.encode(projectXml) },
  { name: "project.xml", content: te.encode(`<?xml version="1.0"?><KNX><Project Id="P-0001" /></KNX>`) },
];

async function expectPasswordError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(KnxPasswordError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("zipDecrypt primitives", () => {
  it("AES block encryption matches node:crypto", () => {
    for (const len of [16, 24, 32]) {
      for (let i = 0; i < 20; i++) {
        const key = randomBytes(len);
        const block = randomBytes(16);
        const ref = createCipheriv(`aes-${len * 8}-ecb`, key, null).setAutoPadding(false).update(block);
        expect(Buffer.from(aesEncryptBlock(new Uint8Array(key), new Uint8Array(block)))).toEqual(ref);
      }
    }
  });

  it("derives the ETS6 archive password like ETS / xknxproject", async () => {
    const expected = pbkdf2Sync(Buffer.from("test", "utf16le"), "21.project.ets.knx.org", 65536, 32, "sha256").toString(
      "base64"
    );
    await expect(deriveEts6ZipPassword("test")).resolves.toBe(expected);
  });
});

describe("extractProtectedProject", () => {
  it("decrypts ETS6 (WinZip AES) archives with the derived password", async () => {
    const zip = buildZip(innerFiles, await deriveEts6ZipPassword("geheim"), "aes");
    const out = await extractProtectedProject(zip, "geheim");
    expect(new TextDecoder().decode(out["0.xml"])).toBe(projectXml);
    expect(Object.keys(out).sort()).toEqual(["0.xml", "project.xml"]);
  });

  it("decrypts ETS4/5 (ZipCrypto) archives with the plain password", async () => {
    const zip = buildZip(innerFiles, "geheim", "zipcrypto");
    const out = await extractProtectedProject(zip, "geheim");
    expect(new TextDecoder().decode(out["0.xml"])).toBe(projectXml);
  });

  it("reports a missing or wrong password", async () => {
    const aes = buildZip(innerFiles, await deriveEts6ZipPassword("geheim"), "aes");
    await expectPasswordError(extractProtectedProject(aes, undefined), "PASSWORD_REQUIRED");
    await expectPasswordError(extractProtectedProject(aes, "falsch"), "PASSWORD_INVALID");

    const legacy = buildZip(innerFiles, "geheim", "zipcrypto");
    await expectPasswordError(extractProtectedProject(legacy, "falsch"), "PASSWORD_INVALID");
  });

  it("extracts unencrypted inner archives without a password", async () => {
    const zip = buildZip(innerFiles, null, "none");
    const out = await extractProtectedProject(zip, undefined);
    expect(Object.keys(out).sort()).toEqual(["0.xml", "project.xml"]);
  });
});

describe("parseKnxproj with password protected projects", () => {
  class MemoryFile {
    readonly lastModified = Date.now();
    readonly type = "application/zip";
    constructor(readonly name: string, private readonly data: Uint8Array) {}
    get size() {
      return this.data.byteLength;
    }
    arrayBuffer() {
      return Promise.resolve(this.data.slice().buffer);
    }
  }

  async function makeProtectedKnxproj(password: string) {
    const inner = buildZip(innerFiles, await deriveEts6ZipPassword(password), "aes");
    const outer = zipSync(
      {
        "knx_master.xml": te.encode(`<?xml version="1.0"?><KNX xmlns="http://knx.org/xml/project/21" />`),
        "P-0001.signature": te.encode("sig"),
        "P-0001.zip": inner,
      },
      { level: 0 }
    );
    return new MemoryFile("secret.knxproj", outer) as unknown as File;
  }

  it("parses the encrypted project when the password is given", async () => {
    const file = await makeProtectedKnxproj("geheim");
    const catalog = await parseKnxproj(file, { password: "geheim" });
    expect(catalog.group_addresses.map((ga) => ga.address)).toEqual(["1/0/1"]);
    expect(catalog.group_addresses[0]?.name).toBe("Kitchen Light");
  });

  it("asks for a password when none is given", async () => {
    const file = await makeProtectedKnxproj("geheim");
    await expectPasswordError(parseKnxproj(file), "PASSWORD_REQUIRED");
    await expectPasswordError(parseKnxproj(file, { password: "nope" }), "PASSWORD_INVALID");
  });
});
