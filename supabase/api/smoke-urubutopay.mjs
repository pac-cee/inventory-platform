#!/usr/bin/env node
// Live smoke test for the UrubutoPay Bulk Disbursement API. Standalone: no
// database, no app import. Reads supabase/api/.env (CRLF-safe) unless the
// variables are already in the environment.
//
//   node smoke-urubutopay.mjs probe
//       Wallet balance with BOTH auth headers (Authorization, x-api-key) to
//       find which one the server honours. Read-only, moves no money.
//
//   node smoke-urubutopay.mjs transfer --phone=0788123456 --amount=100 --confirm
//       Sends a REAL bulk disbursement of one beneficiary from the merchant
//       wallet, then polls check-transfer. Without --confirm it only prints the
//       request it WOULD send. Amount is capped (default 1000 RWF, --max=N to
//       raise). Use a number you control.
//       Bank payout instead: --dest=EKASH --account=100081234567 --name="Test Vendor"
//
//   node smoke-urubutopay.mjs check --ref=<internal_ref> --code=<beneficiary_code>
//       Re-checks one transfer. Read-only.
//
// Common flags: --header=Authorization|x-api-key (default: URUBUTOPAY_AUTH_HEADER
// or Authorization), --base=https://staging.urubutopay.rw
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.includes('"', 1))) v = v.slice(1, v.indexOf('"', 1));
    else v = v.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotenv(path.join(here, ".env"));

const [, , step, ...rest] = process.argv;
const flags = Object.fromEntries(
  rest.filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

const apiKey = process.env.URUBUTOPAY_API_KEY || "";
const walletId = process.env.URUBUTOPAY_WALLET_ACCOUNT_ID || "";
const base = String(flags.base || process.env.URUBUTOPAY_BASE_URL || "https://staging.urubutopay.rw")
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");
const root = `${base}/api`;
const preferredHeader = String(flags.header || process.env.URUBUTOPAY_AUTH_HEADER || "Authorization");

const mask = (s) => (s ? `${s.slice(0, 8)}…(${s.length} chars)` : "(not set)");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(pathname, body, header = preferredHeader) {
  const res = await fetch(`${root}${pathname}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { [header]: apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  }).catch((e) => ({ networkError: e }));
  if (res.networkError) return { http: 0, text: `NETWORK ERROR: ${res.networkError.name}: ${res.networkError.message}`, json: null };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { http: res.status, text, json };
}

const show = (label, r) =>
  console.log(`${label}\n  HTTP ${r.http}\n  ${r.json ? JSON.stringify(r.json) : r.text.slice(0, 200).replace(/\s+/g, " ")}`);

function needKey() {
  if (!apiKey) {
    console.error("URUBUTOPAY_API_KEY is not set (supabase/api/.env or environment). Nothing to do.");
    process.exit(2);
  }
}

console.log(`Target:  ${root}\nKey:     ${mask(apiKey)}\nWallet:  ${walletId || "(not set)"}\nHeader:  ${preferredHeader}\n`);

if (step === "probe") {
  needKey();
  const body = walletId ? { wallet_account_id: walletId } : {};
  const results = {};
  for (const header of ["Authorization", "x-api-key"]) {
    results[header] = await call("/v2/wallet/balance", body, header);
    show(`balance via "${header}":`, results[header]);
  }
  const good = Object.entries(results).filter(([, r]) => r.http === 200);
  console.log("");
  if (good.length) {
    console.log(`RESULT: accepted via ${good.map(([h]) => h).join(" and ")}. Set URUBUTOPAY_AUTH_HEADER accordingly.`);
  } else if (/api key is invalid/i.test(results["Authorization"].text) && results["x-api-key"].http >= 500) {
    console.log("RESULT: the server READS the key from \"Authorization\" (it says the key is invalid) and fails when only \"x-api-key\" is sent, so use Authorization. The key itself was rejected: check it is the right one for this environment, and that this machine's public IP is whitelisted.");
  } else if (Object.values(results).every((r) => r.http === 401 || r.http === 403)) {
    console.log("RESULT: rejected with both headers. Either the key is wrong/expired, or THIS machine's public IP is not whitelisted by UrubutoPay (the spec says non-whitelisted IPs are refused). Check your public IP and ask them to whitelist it.");
  } else {
    console.log("RESULT: neither header returned 200 — see responses above.");
  }
} else if (step === "transfer") {
  needKey();
  if (!walletId) { console.error("URUBUTOPAY_WALLET_ACCOUNT_ID is required for a wallet-funded transfer."); process.exit(2); }
  const amount = Number(flags.amount);
  const max = Number(flags.max || 1000);
  if (!Number.isFinite(amount) || amount <= 0) { console.error("--amount=<RWF> is required."); process.exit(2); }
  if (amount > max) { console.error(`Refusing: ${amount} RWF exceeds the smoke-test cap of ${max}. Pass --max=${amount} if you really mean it.`); process.exit(2); }

  const dest = String(flags.dest || "MOMO");
  const target = dest === "EKASH" ? flags.account : flags.phone;
  if (!target || target === true) { console.error(dest === "EKASH" ? "--account=<bank account> is required for EKASH." : "--phone=<number you control> is required."); process.exit(2); }
  const stamp = Date.now();
  const code = `smoke-${stamp}`;
  const payload = {
    source_of_funds: walletId,
    source_payment_channel: "MERCHANT_WALLET",
    destination_payment_channel: dest,
    external_transaction_ref_number: `smoke-ext-${stamp}`,
    beneficiary_to_be_charged: "NO",
    wallet_account_id: walletId,
    beneficiaries: [{
      beneficiary_names: String(flags.name || "Smoke Test"),
      beneficiary_phone_number: String(target),
      amount,
      beneficiary_code: code,
      description: "Verlet smoke test",
    }],
  };
  console.log("Request:\n" + JSON.stringify(payload, null, 2) + "\n");
  if (!flags.confirm) {
    console.log("DRY RUN — nothing sent. Re-run with --confirm to move REAL money from the wallet.");
    process.exit(0);
  }

  const init = await call("/v2/bulk-disbursement/initiate", payload);
  show("initiate:", init);
  const internalRef = init.json?.data?.internal_transaction_ref_number;
  if (init.http < 200 || init.http >= 300 || !internalRef) {
    console.error("\nInitiate did not return an internal_transaction_ref_number — stopping. If the outcome is unclear, check the UrubutoPay portal before retrying (the external ref above is unique per run).");
    process.exit(1);
  }
  console.log(`\ninternal_transaction_ref_number = ${internalRef}\nbeneficiary_code                = ${code}\n`);
  for (let i = 1; i <= 12; i++) {
    await sleep(5000);
    const r = await call("/v2/bulk-disbursement/check-transfer", { internal_transaction_ref_number: internalRef, beneficiary_code: code });
    const st = r.json?.data?.transaction_status;
    console.log(`check ${i}/12: HTTP ${r.http}  status=${st ?? "?"}  envelope=${r.json ? Object.keys(r.json).join(",") : "non-JSON"}`);
    if (st && !["INITIATED", "PENDING"].includes(String(st).toUpperCase())) { show("final:", r); break; }
  }
  console.log("\nIf still INITIATED/PENDING the callback (or the app's reconciler) will settle it. Re-check later with:\n" +
    `  node smoke-urubutopay.mjs check --ref=${internalRef} --code=${code}`);
} else if (step === "check") {
  needKey();
  if (!flags.ref || !flags.code) { console.error("--ref=<internal_ref> and --code=<beneficiary_code> are required."); process.exit(2); }
  show("check-transfer:", await call("/v2/bulk-disbursement/check-transfer", { internal_transaction_ref_number: flags.ref, beneficiary_code: flags.code }));
} else {
  console.log("Usage: node smoke-urubutopay.mjs <probe | transfer | check> [flags]   (see the header of this file)");
  process.exit(step ? 2 : 0);
}
