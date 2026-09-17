# Trace Your Stolen Crypto — Web Prototype

Static public interface for Poseidon Ledger.

## Current capability

- Bitcoin transaction ID tracing against public mempool.space/Esplora data.
- Breadth-first trace expansion in batches of at most 10 transactions.
- Further work is fetched only when the user clicks **Expand search**; hidden downstream results are not pre-computed.
- Compact forensic paper-trail rendering for long traces and branches.
- Spent/unspent output evidence and downstream TXIDs.
- Bitcoin address validation, balance/UTXO snapshot and recent transactions.
- One-click downloadable ZIP evidence package generated entirely in the browser.
- Individual CSV, JSON and XML exports remain available.
- No wallet connection, private keys, account login, transaction signing or broadcasting.

## Run locally

```bash
cd ~/poseidon/12_ENGINE_ROOM/projects/03_bitcoin_flow_tracker/web
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/` in Firefox.

Use the built-in historical example or paste a Bitcoin TXID/address.

## Evidence package

The primary **Download Evidence Package (.zip)** export contains:

```text
README-FIRST.txt
Evidence-Report.pdf
Transaction-Trace.csv
Evidence.json
Evidence.xml
SHA256SUMS.txt
```

- `README-FIRST.txt` gives plain-language safety, reporting and escalation guidance.
- `Evidence-Report.pdf` is a human-readable report of the currently expanded trace.
- `Transaction-Trace.csv` is spreadsheet-compatible and suitable for Google Sheets, Excel or LibreOffice. Cells are sanitized against spreadsheet-formula injection.
- `Evidence.json` preserves the structured technical evidence object.
- `Evidence.xml` provides an optional interoperability copy and includes an internal SHA-256 payload checksum.
- `SHA256SUMS.txt` records SHA-256 hashes for every package file except the checksum manifest itself.

The ZIP is assembled locally in the browser. Generating it does not upload the trace to a Poseidon server.

Checksums are integrity aids only. They can help detect later file changes, but are **not** digital signatures, trusted timestamps or proof of authorship. A production backend can later add server-side signing and trusted timestamping.

## Reporting guidance

The user chooses a reporting-guidance region rather than Poseidon inferring location from IP data. The initial registry supports:

- General/international guidance;
- Australia: ReportCyber, Australian Cyber Security Hotline and emergency guidance.

INTERPOL guidance is included for cross-border cases, with a clear statement that individuals should report cybercrime to local/national law enforcement first. Police can then coordinate internationally where required.

Contact information must be sourced from official authorities and re-verified before public release.

## Custodial-boundary model

When a later attribution layer identifies a custodial service, the UI should record:

- attributed service;
- attribution confidence;
- attribution source;
- verified legal entity/jurisdiction;
- next evidence holder;
- evidence package required;
- victim reporting route; and
- law-enforcement escalation route.

An exchange label is not treated as proof of customer identity or culpability. A service attribution must retain its source and confidence level.

## Evidence boundary

The interface reports public on-chain facts. It does not claim that an address identifies a person, that an account holder committed an offence, or that funds entering a custodial exchange can be deterministically matched to a later withdrawal without additional evidence.

> Track assets when we can. Track value when asset continuity changes. Never upgrade correlation into proof.

The browser prototype currently performs tracing independently of the Python CLI. A later release should route both interfaces through the same Poseidon Ledger backend/API with signed continuation tokens, caching, rate limits and worker-side resource budgets.

See `PRODUCTION_SECURITY.md` for the server-side abuse-resistance plan. The project-wide evidence-handling principles are in `04_SECURITY/evidence-escalation-doctrine.md` and reporting references in `08_DOCUMENTATION/cybercrime-reporting-directory.md`.
