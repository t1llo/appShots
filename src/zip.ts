import { readFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** Where the content is read from, or the content itself. */
  file?: string;
  data?: Buffer;
  /** The content's size in bytes, where it is known before it is read. A file read at another size fails the archive. */
  size?: number;
}

// A field of the classic format that a value does not fit is written as all ones, and the value itself goes into a
// ZIP64 record. An archive that fits is written exactly as before ZIP64 was supported.
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

/** The values an entry's ZIP64 extra field carries: those that do not fit 32 bits, in the order the format sets. */
const overflowing = (size: number, offset?: number) => [...(size >= MAX32 ? [size, size] : []), ...(offset !== undefined && offset >= MAX32 ? [offset] : [])];
const extraLength = (values: number[]) => (values.length ? 4 + values.length * 8 : 0);
/** Whether the end of the archive needs the ZIP64 record and its locator in front of the classic one. */
const bigEnd = (count: number, directory: number, start: number) => count >= MAX16 || directory >= MAX32 || start >= MAX32;
const endLength = (count: number, directory: number, start: number) => (bigEnd(count, directory, start) ? 56 + 20 : 0) + 22;

function zip64Extra(values: number[]): Buffer {
  const extra = Buffer.alloc(extraLength(values));
  if (values.length === 0) return extra;
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
  return extra;
}

/** The DOS time and date every entry is stamped with, in the server's local time as the ZIP format has it. */
function stampOf(now: Date): { time: number; date: number } {
  return {
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
  };
}

type Stamp = ReturnType<typeof stampOf>;

function localHeader(name: Buffer, size: number, crc: number, stamp: Stamp): Buffer {
  const extra = zip64Extra(overflowing(size));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(extra.length ? 45 : 20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 file names
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(Math.min(size, MAX32), 18);
  header.writeUInt32LE(Math.min(size, MAX32), 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  return Buffer.concat([header, name, extra]);
}

function centralHeader(name: Buffer, size: number, crc: number, offset: number, stamp: Stamp): Buffer {
  const extra = zip64Extra(overflowing(size, offset));
  const version = extra.length ? 45 : 20;
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(version, 4);
  header.writeUInt16LE(version, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(Math.min(size, MAX32), 20);
  header.writeUInt32LE(Math.min(size, MAX32), 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(Math.min(offset, MAX32), 42);
  return Buffer.concat([header, name, extra]);
}

/** The end of the archive: the ZIP64 record and its locator where something overflows, then the classic record. */
function endRecords(count: number, directory: number, start: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, MAX16), 8);
  end.writeUInt16LE(Math.min(count, MAX16), 10);
  end.writeUInt32LE(Math.min(directory, MAX32), 12);
  end.writeUInt32LE(Math.min(start, MAX32), 16);
  if (!bigEnd(count, directory, start)) return end;

  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4); // what follows this field
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(directory), 40);
  record.writeBigUInt64LE(BigInt(start), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(start + directory), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([record, locator, end]);
}

/**
 * How many bytes writeZip writes for these entries, so an archive can be sent with its Content-Length and a client
 * can tell a complete download from one that was cut off.
 */
export function zipSize(entries: Iterable<{ name: string; size: number }>): number {
  let offset = 0;
  let directory = 0;
  let count = 0;
  for (const { name, size } of entries) {
    const length = Buffer.byteLength(name, "utf8");
    directory += 46 + length + extraLength(overflowing(size, offset));
    offset += 30 + length + extraLength(overflowing(size)) + size;
    count++;
  }
  return offset + directory + endLength(count, directory, offset);
}

function write(out: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    out.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Streams a ZIP with the files stored uncompressed. PNGs are already deflated, so compressing them again would cost
 * time for no gain, and storing keeps memory at one file at a time. Entries may come one by one as they are made,
 * and nothing is written before the first of them is at hand, so a failure that early is still an error and not
 * half a file. An archive of more than 4 GiB or 65,534 entries is written as ZIP64.
 */
export async function writeZip(out: Writable, entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>, options: { signal?: AbortSignal } = {}): Promise<void> {
  const stamp = stampOf(new Date());
  const central: Buffer[] = [];
  let offset = 0;
  let directory = 0;

  for await (const entry of entries) {
    options.signal?.throwIfAborted();
    const data = entry.data ?? (await readFile(entry.file!));
    if (entry.size !== undefined && data.length !== entry.size) throw new Error(`${entry.name} was ${entry.size} bytes when the archive was planned and is ${data.length} now.`);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const local = localHeader(name, data.length, crc, stamp);
    await write(out, local);
    await write(out, data);
    const header = centralHeader(name, data.length, crc, offset, stamp);
    central.push(header);
    directory += header.length;
    offset += local.length + data.length;
  }

  options.signal?.throwIfAborted();
  await write(out, Buffer.concat([...central, endRecords(central.length, directory, offset)]));
}
