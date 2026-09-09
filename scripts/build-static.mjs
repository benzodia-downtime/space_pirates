import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDirectory = join(projectRoot, "dist");
const staticFiles = [
  ["index.html", "index.html"],
  ["styles.css", "styles.css"],
  [join("src", "main.js"), join("src", "main.js")],
];

await rm(distDirectory, { recursive: true, force: true });

for (const [source, destination] of staticFiles) {
  const outputPath = join(distDirectory, destination);
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(join(projectRoot, source), outputPath);
}

console.log(`Built ${staticFiles.length} static files in dist.`);
