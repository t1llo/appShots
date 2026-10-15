/**
 * Reads a property list in Apple's binary form, the one the simulators' device types keep their screen sizes in.
 * Enough of the format for that: dictionaries, arrays, numbers, strings, booleans and data. Throws on anything
 * that is not a binary property list.
 * @param {Buffer} buffer
 * @returns {unknown}
 */
export function readBinaryPlist(buffer) {
  if (buffer.length < 40 || buffer.toString("latin1", 0, 8) !== "bplist00") throw new Error("not a binary property list");
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const table = Number(trailer.readBigUInt64BE(24));
  const uint = (at, size) => {
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + buffer[at + i];
    return value;
  };
  const offset = (ref) => {
    if (ref >= count) throw new Error("a reference past the end");
    return uint(table + ref * offsetSize, offsetSize);
  };
  // Nesting deeper than this is a broken file rather than a device type.
  const read = (ref, depth) => {
    if (depth > 32) throw new Error("nested too deeply");
    const at = offset(ref);
    const marker = buffer[at];
    const type = marker >> 4;
    const info = marker & 0x0f;
    if (type === 0x0) return info === 0x9 ? true : info === 0x8 ? false : null;
    if (type === 0x1) return info === 3 ? Number(buffer.readBigInt64BE(at + 1)) : uint(at + 1, 1 << info);
    if (type === 0x2) return info === 2 ? buffer.readFloatBE(at + 1) : buffer.readDoubleBE(at + 1);
    // Past the marker: the length, which takes a number of its own when it does not fit into the marker.
    let length = info;
    let start = at + 1;
    if (info === 0x0f) {
      const size = 1 << (buffer[at + 1] & 0x0f);
      length = uint(at + 2, size);
      start = at + 2 + size;
    }
    if (type === 0x4) return buffer.subarray(start, start + length);
    if (type === 0x5) return buffer.toString("latin1", start, start + length);
    if (type === 0x6) return Buffer.from(buffer.subarray(start, start + length * 2)).swap16().toString("utf16le");
    if (type === 0xa) return Array.from({ length }, (_, i) => read(uint(start + i * refSize, refSize), depth + 1));
    if (type === 0xd) {
      const dict = {};
      for (let i = 0; i < length; i++) dict[String(read(uint(start + i * refSize, refSize), depth + 1))] = read(uint(start + (length + i) * refSize, refSize), depth + 1);
      return dict;
    }
    return null;
  };
  return read(top, 0);
}
