import { crc32, deflateRawSync } from "node:zlib";

export function binaryManifest() {
  const strings = ["manifest", "package", "versionName", "versionCode", "com.example.beta", "1.2.3"];
  const encoded = strings.map((value) => Buffer.concat([Buffer.from([value.length, value.length]), Buffer.from(value), Buffer.from([0])]));
  const stringsStart = 28 + strings.length * 4;
  const pool = Buffer.alloc(Math.ceil((stringsStart + encoded.reduce((sum, value) => sum + value.length, 0)) / 4) * 4);
  pool.writeUInt16LE(1, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(pool.length, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0x100, 16);
  pool.writeUInt32LE(stringsStart, 20);
  let at = stringsStart;
  for (let i = 0; i < encoded.length; i++) {
    pool.writeUInt32LE(at - stringsStart, 28 + i * 4);
    encoded[i].copy(pool, at);
    at += encoded[i].length;
  }
  const start = Buffer.alloc(96);
  start.writeUInt16LE(0x102);
  start.writeUInt16LE(16, 2);
  start.writeUInt32LE(start.length, 4);
  start.writeUInt32LE(0xffffffff, 12);
  start.writeUInt32LE(0xffffffff, 16);
  start.writeUInt16LE(20, 24);
  start.writeUInt16LE(20, 26);
  start.writeUInt16LE(3, 28);
  for (let i = 0; i < 3; i++) {
    const offset = 36 + i * 20;
    start.writeUInt32LE(0xffffffff, offset);
    start.writeUInt32LE(i + 1, offset + 4);
    start.writeUInt32LE(0xffffffff, offset + 8);
    start.writeUInt16LE(8, offset + 12);
    start[offset + 15] = i === 2 ? 0x10 : 3;
    start.writeUInt32LE(i === 2 ? 42 : i + 4, offset + 16);
  }
  const end = Buffer.alloc(24);
  end.writeUInt16LE(0x103);
  end.writeUInt16LE(16, 2);
  end.writeUInt32LE(24, 4);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  const header = Buffer.from([3, 0, 8, 0, 0, 0, 0, 0]);
  header.writeUInt32LE(header.length + pool.length + start.length + end.length, 4);
  return Buffer.concat([header, pool, start, end]);
}

// Reusable synthetic upload/parser fixture, not a third-party or installable signed APK.
// A signature filename is only a marker, not a cryptographic signature.
export function apkFixture(manifest = binaryManifest(), options: { declaredSize?: number; duplicate?: boolean } = {}) {
  const entries = [{ name: "AndroidManifest.xml", data: manifest }, { name: "META-INF/TEST.RSA", data: Buffer.from("fixture") }];
  if (options.duplicate) entries.push(entries[0]);
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = deflateRawSync(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(entry.data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.name === "AndroidManifest.xml" ? options.declaredSize ?? entry.data.length : entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    header.copy(directory, 6, 4, 28);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
