import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve("sidepanel", "dist");
const targetDir = path.resolve("dist", "sidepanel");

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });
