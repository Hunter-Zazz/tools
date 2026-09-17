"use strict";

/*
 * Poseidon Ledger evidence export.
 *
 * All package generation is performed in the browser. The evidence package
 * contains human-readable, spreadsheet and structured technical copies.
 * Checksums are integrity aids, not digital signatures or proof of authorship.
 */

const POSEIDON_XML_SCHEMA_VERSION = "1.0";
const REPORTING_CONTACTS_VERIFIED = "2026-09-17";

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlTagName(value) {
  const cleaned = String(value)
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^[^A-Za-z_]+/, "");
  return cleaned || "item";
}

function valueToXml(name, value, indent = "") {
  const tag = xmlTagName(name);

  if (value === null || value === undefined) return `${indent}<${tag} nil="true"/>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}<${tag}/>`;
    const children = value.map((item, index) => {
      if (item !== null && typeof item === "object") {
        return `${indent}  <item index="${index}">\n${objectToXml(item, `${indent}    `)}\n${indent}  </item>`;
      }
      return `${indent}  <item index="${index}">${xmlEscape(item)}</item>`;
    }).join("\n");
    return `${indent}<${tag}>\n${children}\n${indent}</${tag}>`;
  }

  if (typeof value === "object") {
    return `${indent}<${tag}>\n${objectToXml(value, `${indent}  `)}\n${indent}</${tag}>`;
  }

  return `${indent}<${tag}>${xmlEscape(value)}</${tag}>`;
}

function objectToXml(object, indent = "") {
  return Object.entries(object)
    .map(([key, value]) => valueToXml(key, value, indent))
    .join("\n");
}

async function sha256HexBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text) {
  return sha256HexBytes(new TextEncoder().encode(text));
}

function evidenceStem() {
  if (!latestEvidence?.query?.value) return "poseidon-ledger-evidence";
  const id = latestEvidence.query.value.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 24) || "trace";
  return `poseidon-ledger-${id}`;
}

function evidenceFilename(extension) {
  return `${evidenceStem()}.${extension}`;
}

function saveBlob(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function buildEvidenceXml() {
  const payloadBody = objectToXml(latestEvidence, "    ");
  const payloadXml = `  <evidencePayload>\n${payloadBody}\n  </evidencePayload>`;
  const digest = await sha256Hex(payloadXml);
  const exportedAt = new Date().toISOString();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<poseidonLedgerEvidence schemaVersion="${POSEIDON_XML_SCHEMA_VERSION}">`,
    "  <packageMetadata>",
    "    <format>Poseidon Ledger XML Evidence Package</format>",
    `    <exported_at>${xmlEscape(exportedAt)}</exported_at>`,
    "    <integrity>",
    "      <algorithm>SHA-256</algorithm>",
    "      <scope>exact evidencePayload XML element</scope>",
    `      <digest>${digest}</digest>`,
    "      <note>Checksum detects changes to the exported payload; it is not a digital signature or proof of authorship.</note>",
    "    </integrity>",
    "  </packageMetadata>",
    payloadXml,
    "</poseidonLedgerEvidence>",
    "",
  ].join("\n");
}

function spreadsheetSafe(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = spreadsheetSafe(value).replaceAll('"', '""');
  return `"${text}"`;
}

function flattenTrace(node, rows = [], path = "root") {
  if (!node) return rows;

  if (node.pending || node.repeated || node.depthLimited || node.frontierLimited) {
    rows.push({
      path,
      depth: node.depth ?? "",
      txid: node.txid || "",
      vout: "",
      value_sats: "",
      value_btc: "",
      destination: "",
      script_type: "",
      state: node.pending ? "PENDING" : node.repeated ? "REPEATED" : "LIMITED",
      spent_by: "",
      block_height: "",
      block_time_utc: "",
      evidence_class: latestEvidence?.evidence_class || "",
    });
    return rows;
  }

  for (const output of node.outputs || []) {
    rows.push({
      path: `${path}/vout-${output.index}`,
      depth: node.depth,
      txid: node.txid,
      vout: output.index,
      value_sats: output.value,
      value_btc: (Number(output.value) / 100000000).toFixed(8),
      destination: output.address || "",
      script_type: output.scriptType || "",
      state: output.spent ? "SPENT" : "UNSPENT",
      spent_by: output.spentBy || "",
      block_height: node.blockHeight ?? "",
      block_time_utc: node.blockTime ? new Date(node.blockTime * 1000).toISOString() : "",
      evidence_class: latestEvidence?.evidence_class || "",
    });

    if (output.child) flattenTrace(output.child, rows, `${path}/vout-${output.index}/child`);
  }

  return rows;
}

function buildEvidenceCsv() {
  const headers = [
    "path", "depth", "txid", "vout", "value_sats", "value_btc", "destination",
    "script_type", "state", "spent_by", "block_height", "block_time_utc", "evidence_class",
  ];

  let rows = [];
  if (latestEvidence?.trace) {
    rows = flattenTrace(latestEvidence.trace);
  } else if (Array.isArray(latestEvidence?.utxos)) {
    rows = latestEvidence.utxos.map((item, index) => ({
      path: `address/utxo-${index}`,
      depth: "",
      txid: item.txid || "",
      vout: item.vout ?? "",
      value_sats: item.value ?? "",
      value_btc: item.value !== undefined ? (Number(item.value) / 100000000).toFixed(8) : "",
      destination: latestEvidence.query?.value || "",
      script_type: "",
      state: "UNSPENT",
      spent_by: "",
      block_height: item.status?.block_height ?? "",
      block_time_utc: item.status?.block_time ? new Date(item.status.block_time * 1000).toISOString() : "",
      evidence_class: latestEvidence?.evidence_class || "",
    }));
  }

  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

function reportingCountry() {
  return document.querySelector("#reporting-country")?.value || "general";
}

function buildReadme() {
  const country = reportingCountry();
  const lines = [
    "POSEIDON LEDGER - EVIDENCE PACKAGE",
    "==================================",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Evidence class: ${latestEvidence?.evidence_class || "UNSPECIFIED"}`,
    `Query: ${latestEvidence?.query?.value || ""}`,
    "",
    "PURPOSE",
    "-------",
    "This package records publicly observable blockchain evidence associated with the transaction or address submitted to Poseidon Ledger.",
    "It can help investigators understand where funds moved. It does not by itself identify an offender, prove who controlled a wallet, or establish criminal culpability.",
    "",
    "DO NOT BECOME THE INVESTIGATOR",
    "------------------------------",
    "Do not attempt to identify, confront, contact, hack, access or independently recover assets from a suspected offender, wallet, exchange account or service.",
    "Do not send cryptocurrency or money to anyone claiming they can recover your funds.",
    "Preserve this package and provide it to law enforcement or the relevant official reporting channel.",
    "",
    "RECOMMENDED NEXT STEPS",
    "----------------------",
    "1. Keep this ZIP and an unchanged backup copy.",
    "2. Report the incident to your local or national police/cybercrime authority.",
    "3. Provide this evidence package with your report.",
    "4. If Poseidon identifies a custodial exchange, contact that exchange only through its official fraud/recovery route.",
    "5. Give the exchange your police/cybercrime reference number if requested.",
    "6. Allow law enforcement to make formal requests for customer records, freezing action or international assistance where appropriate.",
    "",
  ];

  if (country === "AU") {
    lines.push(
      "AUSTRALIA REPORTING ROUTE",
      "-------------------------",
      "ReportCyber: https://www.cyber.gov.au/report-and-recover/report",
      "Australian Cyber Security Hotline: 1300 CYBER1 (1300 292 371)",
      "Immediate threat to life or risk of harm: 000",
      `Contact details verified from official Cyber.gov.au sources on ${REPORTING_CONTACTS_VERIFIED}.`,
      "",
    );
  } else {
    lines.push(
      "LOCAL REPORTING ROUTE",
      "---------------------",
      "Report the crime to your local or national police/cybercrime authority first.",
      "If your case crosses borders, your police agency can use international law-enforcement channels where appropriate.",
      "",
    );
  }

  lines.push(
    "INTERPOL - INTERNATIONAL CASES",
    "------------------------------",
    "Individuals cannot report cybercrime directly to INTERPOL. Report the incident to local/national law enforcement first; they can coordinate with INTERPOL if international assistance is required.",
    "INTERPOL General Secretariat general email: CCCPublicMail@interpol.int",
    "INTERPOL General Secretariat telephone: +33 4 72 44 70 00",
    "Official contact page: https://www.interpol.int/Contacts/Contact-INTERPOL",
    "Cybercrime guidance: https://www.interpol.int/Crimes/Cybercrime/Cybercrime-our-response",
    "These INTERPOL details are for general contact and are not a replacement for filing a police report.",
    `Contact details verified from official INTERPOL sources on ${REPORTING_CONTACTS_VERIFIED}.`,
    "",
    "PACKAGE CONTENTS",
    "----------------",
    "README-FIRST.txt       This file - safety and reporting guidance.",
    "Evidence-Report.pdf    Human-readable summary of the currently expanded trace.",
    "Transaction-Trace.csv  Spreadsheet-compatible evidence trail for Google Sheets, Excel or LibreOffice.",
    "Evidence.json          Structured technical record.",
    "Evidence.xml           XML interoperability copy with an internal payload checksum.",
    "SHA256SUMS.txt         SHA-256 hashes for package files (does not include itself).",
    "",
    "INTEGRITY NOTE",
    "--------------",
    "SHA-256 hashes can help detect later changes to files. They are not a digital signature, proof of authorship or chain-of-custody certification.",
    "",
    "POSEIDON DOCTRINE",
    "-----------------",
    "Track assets when we can. Track value when asset continuity changes. Never upgrade correlation into proof.",
    "Preserve -> Understand -> Document -> Verify -> Package -> Report -> Escalate",
    "",
  );

  return lines.join("\r\n");
}

function reportLines() {
  const lines = [
    "POSEIDON LEDGER - EVIDENCE REPORT",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Query type: ${latestEvidence?.query?.type || ""}`,
    `Query: ${latestEvidence?.query?.value || ""}`,
    `Evidence class: ${latestEvidence?.evidence_class || ""}`,
    `Provider: ${latestEvidence?.provider || ""}`,
    "",
    "SUMMARY",
  ];

  if (latestEvidence?.summary) {
    for (const [key, value] of Object.entries(latestEvidence.summary)) lines.push(`${key}: ${value}`);
  }
  if (latestEvidence?.search_controls) {
    lines.push(`transactions_analysed: ${latestEvidence.search_controls.transactions_analysed ?? ""}`);
    lines.push(`pending_frontier: ${latestEvidence.search_controls.pending_frontier ?? ""}`);
  }

  lines.push("", "TRACE OUTPUTS");
  const rows = latestEvidence?.trace ? flattenTrace(latestEvidence.trace) : [];
  for (const row of rows) {
    lines.push(
      `Depth ${row.depth} | ${row.value_btc || ""} BTC | ${row.state} | TX ${row.txid || ""}${row.vout !== "" ? `:${row.vout}` : ""}`,
      `  Destination: ${row.destination || row.script_type || "not exposed"}`,
      row.spent_by ? `  Spent by: ${row.spent_by}` : "",
    );
  }

  lines.push(
    "",
    "EVIDENCE LIMITATIONS",
    "A blockchain path proves movement between transaction outputs. It does not, by itself, prove who controlled an address or who committed an offence.",
    "Custodial exchange attribution requires a source and confidence level. Customer identity behind a custodial account requires the custodian and lawful process.",
    "",
    "SAFETY AND ESCALATION",
    "Do not identify, confront, contact, hack or independently recover assets from a suspected offender. Preserve the evidence and report it through lawful channels.",
    "See README-FIRST.txt in this package for reporting guidance and contact details.",
  );

  return lines.filter((line) => line !== undefined);
}

function asciiPdfText(value) {
  return String(value)
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapText(line, width = 88) {
  const text = asciiPdfText(line);
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const out = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { out.push(current); current = word; }
  }
  if (current) out.push(current);
  return out;
}

function pdfEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function buildSimplePdf() {
  const encoder = new TextEncoder();
  const wrapped = reportLines().flatMap((line) => wrapText(line));
  const perPage = 52;
  const pages = [];
  for (let i = 0; i < wrapped.length; i += perPage) pages.push(wrapped.slice(i, i + perPage));
  if (!pages.length) pages.push(["Poseidon Ledger Evidence Report"]);

  const objectCount = 3 + pages.length * 2;
  const objects = new Array(objectCount + 1);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((pageLines, index) => {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    const content = [
      "BT",
      "/F1 9 Tf",
      "11 TL",
      "45 800 Td",
      ...pageLines.flatMap((line, lineIndex) => [
        `${lineIndex === 0 ? "" : "0 -11 Td\n"}(${pdfEscape(line)}) Tj`,
      ]),
      "ET",
    ].join("\n");
    const contentLength = encoder.encode(content).length;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`;
  });

  const chunks = [encoder.encode("%PDF-1.4\n%Poseidon\n")];
  const offsets = new Array(objectCount + 1).fill(0);
  let byteOffset = chunks[0].length;

  for (let i = 1; i <= objectCount; i += 1) {
    offsets[i] = byteOffset;
    const chunk = encoder.encode(`${i} 0 obj\n${objects[i]}\nendobj\n`);
    chunks.push(chunk);
    byteOffset += chunk.length;
  }

  const xrefOffset = byteOffset;
  const xref = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];
  for (let i = 1; i <= objectCount; i += 1) xref.push(`${String(offsets[i]).padStart(10, "0")} 00000 n `);
  xref.push("trailer", `<< /Size ${objectCount + 1} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF", "");
  chunks.push(encoder.encode(xref.join("\n")));
  return concatBytes(chunks);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zipHeader(size) {
  return new Uint8Array(size);
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function buildStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(file.bytes);
    const crc = crc32(data);

    const local = zipHeader(30);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
    u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, crc); u32(lv, 18, data.length);
    u32(lv, 22, data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
    localParts.push(local, name, data);

    const central = zipHeader(46);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
    u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, crc); u32(cv, 20, data.length);
    u32(cv, 24, data.length); u16(cv, 28, name.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0);
    u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, localOffset);
    centralParts.push(central, name);

    localOffset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipHeader(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, files.length); u16(ev, 10, files.length);
  u32(ev, 12, centralSize); u32(ev, 16, localOffset); u16(ev, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function downloadEvidenceXml() {
  if (!latestEvidence) return;
  saveBlob(await buildEvidenceXml(), "application/xml;charset=utf-8", evidenceFilename("xml"));
}

function downloadEvidenceCsv() {
  if (!latestEvidence) return;
  saveBlob(buildEvidenceCsv(), "text/csv;charset=utf-8", evidenceFilename("csv"));
}

async function downloadEvidencePackage() {
  if (!latestEvidence) return;

  const encoder = new TextEncoder();
  const readme = buildReadme();
  const pdf = buildSimplePdf();
  const csv = buildEvidenceCsv();
  const json = JSON.stringify(latestEvidence, null, 2) + "\n";
  const xml = await buildEvidenceXml();

  const packageFiles = [
    { name: "README-FIRST.txt", bytes: encoder.encode(readme) },
    { name: "Evidence-Report.pdf", bytes: pdf },
    { name: "Transaction-Trace.csv", bytes: encoder.encode(csv) },
    { name: "Evidence.json", bytes: encoder.encode(json) },
    { name: "Evidence.xml", bytes: encoder.encode(xml) },
  ];

  const sums = [];
  for (const file of packageFiles) sums.push(`${await sha256HexBytes(file.bytes)}  ${file.name}`);
  packageFiles.push({ name: "SHA256SUMS.txt", bytes: encoder.encode(sums.join("\r\n") + "\r\n") });

  saveBlob(buildStoredZip(packageFiles), "application/zip", `${evidenceStem()}-evidence-package.zip`);
}

const downloadTxXml = document.querySelector("#download-tx-xml");
const downloadAddressXml = document.querySelector("#download-address-xml");
const downloadTxCsv = document.querySelector("#download-tx-csv");
const downloadAddressCsv = document.querySelector("#download-address-csv");
const downloadTxPackage = document.querySelector("#download-tx-package");
const downloadAddressPackage = document.querySelector("#download-address-package");

if (downloadTxXml) downloadTxXml.addEventListener("click", downloadEvidenceXml);
if (downloadAddressXml) downloadAddressXml.addEventListener("click", downloadEvidenceXml);
if (downloadTxCsv) downloadTxCsv.addEventListener("click", downloadEvidenceCsv);
if (downloadAddressCsv) downloadAddressCsv.addEventListener("click", downloadEvidenceCsv);
if (downloadTxPackage) downloadTxPackage.addEventListener("click", downloadEvidencePackage);
if (downloadAddressPackage) downloadAddressPackage.addEventListener("click", downloadEvidencePackage);
