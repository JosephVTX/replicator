import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const EXCLUDED = new Set(["node_modules", ".git", ".replica", "dist", ".vite"]);

/** Zips a replica project (source template) into `outFile`, returns the size in bytes. */
export async function zipDirectory(srcDir: string, outFile: string): Promise<number> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.glob("**/*", {
      cwd: srcDir,
      dot: true,
      ignore: [...EXCLUDED].map((d) => `${d}/**`) as string[],
    });
    archive.finalize().catch(reject);
  });
  return fs.statSync(outFile).size;
}
