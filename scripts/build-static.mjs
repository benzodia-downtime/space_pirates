import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDirectory = join(projectRoot, "dist");
const staticFiles = [
  ["index.html", "index.html"],
  ["styles.css", "styles.css"],
  ["voyage.css", "voyage.css"],
  ["battle.css", "battle.css"],
  [join("src", "main.js"), join("src", "main.js")],
  [join("src", "voyage.js"), join("src", "voyage.js")],
  [join("src", "navigation.js"), join("src", "navigation.js")],
  [join("src", "assault.js"), join("src", "assault.js")],
  [join("src", "assault-audio.js"), join("src", "assault-audio.js")],
  [join("src", "voyage-renderer.js"), join("src", "voyage-renderer.js")],
  [join("node_modules", "three", "build", "three.module.js"), join("vendor", "three.module.js")],
  [join("node_modules", "three", "build", "three.core.js"), join("vendor", "three.core.js")],
  [join("node_modules", "three", "LICENSE"), join("vendor", "three-LICENSE.txt")],
  [join("assets", "crew-player.png"), join("assets", "crew-player.png")],
  [join("assets", "crew-enemy.png"), join("assets", "crew-enemy.png")],
];

await rm(distDirectory, { recursive: true, force: true });

for (const [source, destination] of staticFiles) {
  const outputPath = join(distDirectory, destination);
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(join(projectRoot, source), outputPath);
}

console.log(`Built ${staticFiles.length} static files in dist.`);
