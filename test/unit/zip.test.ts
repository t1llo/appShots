import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import { writeZip, type ZipEntry, zipSize } from "../../src/zip.ts";
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

test("a ZIP of more than 65,535 entries is written as ZIP64", async () => {
  const entries = Array.from({ length: 65_536 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.alloc(0) }));
  const zip = await zipOf(entries);
  // The ZIP64 end record and its locator stand before the classic end record.
  assert.equal(zip.readUInt32LE(zip.length - 22 - 20), 0x07064b50);
  const record = Number(zip.readBigUInt64LE(zip.length - 22 - 20 + 8));
  assert.equal(zip.readUInt32LE(record), 0x06064b50);
  assert.equal(Number(zip.readBigUInt64LE(record + 32)), 65_536);
  assert.equal(zip.length, zipSize(entries.map(({ name }) => ({ name, size: 0 }))));
});

/** Writes the archive to a file and has the system's unzip test every entry in it. */
async function unzipTest(entries: ZipEntry[]): Promise<string> {
  const file = path.join(scratch.dir, `test-${entries.length}.zip`);
  await writeFile(file, await zipOf(entries));
  const { stdout } = await promisify(execFile)("unzip", ["-tq", file]);
  return stdout;
}

test("unzip accepts the archives as they are written, ZIP64 included", async () => {
  const small = await unzipTest([
    { name: "README.txt", data: Buffer.from("Where each folder goes\n") },
    { name: "de-DE/Übersicht.txt", data: Buffer.from("Ä") },
  ]);
  assert.match(small, /No errors detected/);
  const many = await unzipTest(Array.from({ length: 65_536 }, (_, i) => ({ name: `${i}.txt`, data: Buffer.from(String(i)) })));
  assert.match(many, /No errors detected/);
});

test("the size worked out ahead is the size written, so it can be sent as Content-Length", async () => {
  const sets = [
    [],
    [{ name: "README.txt", data: Buffer.from("Where each folder goes\n") }],
    [
      { name: "de-DE/Übersicht.txt", data: Buffer.from("Ä") },
      { name: "en-US/iphone-6.9/01.png", data: Buffer.alloc(70_000, 7) },
    ],
  ];
  for (const entries of sets) assert.equal((await zipOf(entries)).length, zipSize(entries.map(({ name, data }) => ({ name, size: data.length }))));
});

test("entries that start past 4 GiB are found through their ZIP64 offsets", async () => {
  // Seventeen entries of 256 MiB make 4.25 GiB. They share one buffer, and the sink keeps only the directory.
  const chunk = Buffer.alloc(256 * 1024 * 1024, 1);
  const entries = Array.from({ length: 17 }, (_, i) => ({ name: `${String(i).padStart(2, "0")}.bin`, data: chunk }));
  let written = 0;
  let last: Buffer = Buffer.alloc(0);
  const sink = new Writable({
    write(data: Buffer, _encoding, done) {
      written += data.length;
      if (data !== chunk) last = data;
      done();
    },
  });
  await writeZip(sink, entries);
  assert.equal(written, zipSize(entries.map(({ name }) => ({ name, size: chunk.length }))));

  // The directory and the end records come in the last write.
  const directoryStart = written - last.length;
  const locator = last.length - 22 - 20;
  assert.equal(last.readUInt32LE(locator), 0x07064b50);
  const record = Number(last.readBigUInt64LE(locator + 8)) - directoryStart;
  assert.equal(last.readUInt32LE(record), 0x06064b50);
  assert.equal(Number(last.readBigUInt64LE(record + 32)), 17);
  assert.equal(Number(last.readBigUInt64LE(record + 48)), directoryStart);
  assert.equal(last.readUInt32LE(last.length - 22 + 16), 0xffffffff, "the classic record points on to the ZIP64 one");

  let at = 0;
  const offsets = [];
  for (let i = 0; i < 17; i++) {
    assert.equal(last.readUInt32LE(at), 0x02014b50);
    const nameLength = last.readUInt16LE(at + 28);
    const extraLength = last.readUInt16LE(at + 30);
    let offset = last.readUInt32LE(at + 42);
    if (offset === 0xffffffff) {
      const extra = at + 46 + nameLength;
      assert.equal(last.readUInt16LE(extra), 0x0001);
      offset = Number(last.readBigUInt64LE(extra + 4));
    } else assert.equal(extraLength, 0, "an entry that fits has no extra field");
    offsets.push(offset);
    at += 46 + nameLength + extraLength;
  }
  const local = 30 + "00.bin".length + chunk.length;
  assert.deepEqual(offsets, Array.from({ length: 17 }, (_, i) => i * local));
  assert.ok(offsets[16] > 0xffffffff);
});

test("an archive stops when it is called off, before the next entry", async () => {
  const controller = new AbortController();
  async function* entries() {
    yield { name: "01.txt", data: Buffer.from("one") };
    controller.abort();
    yield { name: "02.txt", data: Buffer.from("two") };
  }
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  await assert.rejects(writeZip(out, entries(), { signal: controller.signal }), { name: "AbortError" });
  assert.equal(chunks.length, 2, "the first entry's header and data, nothing after");
});
