import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import { crc32 } from "node:zlib";
import { writeZip, type ZipEntry } from "../../src/zip.ts";
import { tmpData } from "../helpers/tmp-data.ts";

const scratch = await tmpData("zip");
after(() => scratch.remove());

async function zipOf(entries: ZipEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  await writeZip(out, entries);
  return Buffer.concat(chunks);
}

/** Reads a ZIP the way an unzip tool does: from the directory at its end, checking every entry's CRC. */
function unzip(zip: Buffer): { name: string; data: Buffer }[] {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, "end of central directory");
  const count = zip.readUInt16LE(end + 10);
  assert.equal(zip.readUInt16LE(end + 8), count);
  let at = zip.readUInt32LE(end + 16);
  assert.equal(at + zip.readUInt32LE(end + 12), end, "directory size");
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "central header");
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    assert.equal(zip.readUInt32LE(offset), 0x04034b50, `local header of ${name}`);
    assert.equal(zip.readUInt16LE(offset + 8), 0, "stored");
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    entries.push({ name, data });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

test("a ZIP holds every entry as it was given, from memory and from disk", async () => {
  const file = path.join(scratch.dir, "01.png");
  const onDisk = Buffer.alloc(70_000, 7);
  await writeFile(file, onDisk);
  const zip = await zipOf([
    { name: "README.txt", data: Buffer.from("Where each folder goes\n") },
    { name: "en-US/iphone-6.9/01.png", file },
    { name: "de-DE/Übersicht.txt", data: Buffer.from("Ä") },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ]);
  assert.deepEqual(unzip(zip), [
    { name: "README.txt", data: Buffer.from("Where each folder goes\n") },
    { name: "en-US/iphone-6.9/01.png", data: onDisk },
    { name: "de-DE/Übersicht.txt", data: Buffer.from("Ä") },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ]);
});

test("a ZIP with no entries is still a ZIP", async () => {
  assert.deepEqual(unzip(await zipOf([])), []);
});

test("a ZIP of more than 65,535 entries is written as ZIP64", { todo: "srv-14" }, async () => {
  const entries = Array.from({ length: 65_536 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.alloc(0) }));
  const zip = await zipOf(entries);
  // The ZIP64 end record and its locator stand before the classic end record.
  assert.equal(zip.readUInt32LE(zip.length - 22 - 20), 0x07064b50);
  const record = Number(zip.readBigUInt64LE(zip.length - 22 - 20 + 8));
  assert.equal(zip.readUInt32LE(record), 0x06064b50);
  assert.equal(Number(zip.readBigUInt64LE(record + 32)), 65_536);
});
