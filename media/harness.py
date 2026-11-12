"""Shared Playwright harness: opens the web app against a chosen RPC with local role keys.

Keys are read from ../keys and injected into the page at runtime only (window.__VERIDOM_DEV_KEYS__);
they are never written into the build, the repo, or the recording.
"""
import json, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def init_script(rpc: str, deployment_file: str, demo_key: str = "B", extra: dict | None = None) -> str:
    dep = json.loads((ROOT / "contracts/deployments" / deployment_file).read_text())
    run_name = "demo-run-local.json" if "local" in deployment_file else "demo-run.json"
    run = json.loads((ROOT / "contracts/deployments" / run_name).read_text())
    keys = {r: (ROOT / "keys" / f"{f}.key").read_text().strip() for r, f in
            [("Homeowner", "homeowner"), ("Contractor", "contractor"), ("Inspector", "inspector"), ("Arbiter", "deployer")]}
    cfg = {
        "rpcUrl": rpc,
        "factory": dep["factory"], "lens": dep["lens"], "escrowImplementation": dep["escrowImplementation"],
        "deployedAtBlock": dep["deployedAtBlock"],
        "demoProject": run["projects"].get(demo_key),
        "transactions": [{"label": t["label"], "hash": t["hash"]} for t in run["txs"]],
    }
    if extra: cfg.update(extra)
    return f"window.__VERIDOM_CONFIG__ = {json.dumps(cfg)}; window.__VERIDOM_DEV_KEYS__ = {json.dumps(keys)};"
