import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const distDir = path.resolve("dist");
const exportDir = path.resolve("export");
const zipFile = path.resolve(exportDir, `${packageJson.name}-${packageJson.version}.zip`);

fs.mkdirSync(exportDir, { recursive: true });
fs.rmSync(path.join(distDir, ".DS_Store"), { force: true });
execFileSync(
    "powershell.exe",
    [
        "-NoProfile",
        "-Command",
        "Compress-Archive -Path * -DestinationPath ../export/$env:ZIP_FILE -Force",
    ],
    {
        cwd: distDir,
        stdio: "inherit",
        env: {
            ...process.env,
            ZIP_FILE: path.basename(zipFile),
        },
    },
);
