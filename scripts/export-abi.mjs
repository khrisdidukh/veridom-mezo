// Copies the compiled ABIs from Foundry's out/ into the web app so both always match.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "web/src/abi");
mkdirSync(outDir, { recursive: true });
for (const name of ["BuildFundEscrow", "BuildFundFactory", "BuildFundLens"]) {
  const artifact = JSON.parse(readFileSync(join(root, `contracts/out/${name}.sol/${name}.json`), "utf8"));
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`exported ${name} (${artifact.abi.length} entries)`);
}
