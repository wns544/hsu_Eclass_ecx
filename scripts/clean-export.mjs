import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const exportFile = path.resolve("export", `${packageJson.name}-${packageJson.version}.zip`);

fs.rmSync(exportFile, { force: true });
