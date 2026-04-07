import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");

fs.mkdirSync(distDir, { recursive: true });
for (const entry of fs.readdirSync(distDir)) {
    fs.rmSync(path.join(distDir, entry), { recursive: true, force: true });
}
