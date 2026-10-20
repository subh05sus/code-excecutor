/**
 * A minimal ustar archive writer — enough to copy a student's project into a
 * sandbox with `putArchive` (dockerode), which needs no network inside it.
 */

export type TarEntry = { name: string; data?: Buffer; dir?: boolean; mode?: number };

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, mode: number, type: "0" | "5"): Buffer {
  const h = Buffer.alloc(512, 0);
  let base = name;
  let prefix = "";
  // Names over 100 bytes go into the 155-byte prefix, split at a slash.
  if (Buffer.byteLength(base) > 100) {
    const cut = name.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Path too long for the archive: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  h.write(base, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** The archive of these entries; every parent folder gets its own entry first. */
export function tarOf(entries: TarEntry[]): Buffer {
  const out: Buffer[] = [];
  const dirs = new Set<string>();
  const addDir = (d: string) => {
    if (!d || dirs.has(d)) return;
    const parent = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
    addDir(parent);
    dirs.add(d);
    out.push(header(`${d}/`, 0, 0o755, "5"));
  };
  for (const e of entries) {
    const name = e.name.replace(/^\/+/, "");
    if (e.dir) {
      addDir(name.replace(/\/+$/, ""));
      continue;
    }
    addDir(name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");
    const data = e.data ?? Buffer.alloc(0);
    out.push(header(name, data.length, e.mode ?? 0o644, "0"), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}
