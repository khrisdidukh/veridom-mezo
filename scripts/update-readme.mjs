// Writes the deployment section of README.md from contracts/deployments/*.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const X = "https://explorer.test.mezo.org";
const dep = JSON.parse(readFileSync(join(root, "contracts/deployments/mezo-testnet.json"), "utf8"));
const runPath = join(root, "contracts/deployments/demo-run.json");
const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, "utf8")) : { txs: [], projects: {} };
const a = (x) => `[\`${x}\`](${X}/address/${x})`;
let md = `## Deployment (Mezo testnet, chain 31611)\n\n| Contract | Address |\n| --- | --- |\n`;
md += `| BuildFundFactory | ${a(dep.factory)} |\n| BuildFundEscrow (implementation) | ${a(dep.escrowImplementation)} |\n| BuildFundLens | ${a(dep.lens)} |\n`;
if (run.projects.A) md += `| Demo project A — complete lifecycle | ${a(run.projects.A)} |\n`;
if (run.projects.B) md += `| Demo project B — in progress (default in the app) | ${a(run.projects.B)} |\n`;
if (run.txs.length) {
  md += `\n<details><summary><b>${run.txs.length} demo transactions</b> (full lifecycle, four wallets: homeowner, contractor, inspector, arbiter/relayer)</summary>\n\n| # | Step | From | Tx |\n| --- | --- | --- | --- |\n`;
  run.txs.forEach((t, i) => (md += `| ${i + 1} | ${t.label.replace(/\|/g, "/")} | ${t.from} | [${t.hash.slice(0, 10)}…](${X}/tx/${t.hash}) |\n`));
  md += `\n</details>\n`;
}
const readme = readFileSync(join(root, "README.md"), "utf8");
writeFileSync(join(root, "README.md"), readme.replace(/<!-- DEPLOYMENT:START -->[\s\S]*<!-- DEPLOYMENT:END -->/, `<!-- DEPLOYMENT:START -->\n${md}<!-- DEPLOYMENT:END -->`));
console.log("README deployment section updated");
