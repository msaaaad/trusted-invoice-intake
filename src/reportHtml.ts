import { Prisma } from "@prisma/client";

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice Intake Report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f7f7f8; color: #1a1a1a; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  #generatedAt { color: #666; font-size: 0.85rem; margin-top: 0; }
  .summary { display: flex; gap: 0.6rem; margin: 1rem 0 1.25rem; flex-wrap: wrap; }
  .badge { padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
  .badge.REGISTERED { background: #d1fae5; color: #065f46; }
  .badge.NEEDS_REVIEW { background: #fef3c7; color: #92400e; }
  .badge.SKIPPED_DUPLICATE { background: #e5e7eb; color: #374151; }
  .badge.FAILED_PARTNER, .badge.FAILED_DUPLICATE, .badge.FAILED_AMOUNT, .badge.FAILED_VALIDATION { background: #fee2e2; color: #991b1b; }
  .filters { margin-bottom: 1rem; }
  .filters button { margin-right: 0.4rem; padding: 0.4rem 0.8rem; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  .filters button.active { background: #1a1a1a; color: white; border-color: #1a1a1a; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { text-align: left; padding: 0.6rem 0.9rem; border-bottom: 1px solid #eee; font-size: 0.88rem; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; }
  .reason { color: #555; font-size: 0.83rem; max-width: 320px; }
  details summary { cursor: pointer; color: #2563eb; font-size: 0.82rem; margin-top: 0.3rem; }
  pre { white-space: pre-wrap; font-size: 0.78rem; background: #f3f4f6; padding: 0.5rem; border-radius: 6px; margin: 0.3rem 0 0; }
</style>
</head>
<body>
<h1>Invoice Intake Report</h1>
<p id="generatedAt"></p>
<div class="summary" id="summary"></div>
<div class="filters" id="filters"></div>
<table>
  <thead><tr><th>File</th><th>Status</th><th>Partner</th><th>Invoice #</th><th>Total</th><th>Accounting ID</th><th>Reason</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
const DATA = __DATA__;

document.getElementById("generatedAt").textContent = "Generated " + DATA.generatedAt;

const counts = {};
for (const inv of DATA.invoices) counts[inv.status] = (counts[inv.status] || 0) + 1;

const summaryEl = document.getElementById("summary");
for (const [status, count] of Object.entries(counts)) {
  const span = document.createElement("span");
  span.className = "badge " + status;
  span.textContent = status + ": " + count;
  summaryEl.appendChild(span);
}

let activeFilter = "ALL";
const filtersEl = document.getElementById("filters");
const statuses = ["ALL", ...Object.keys(counts)];

function renderFilters() {
  filtersEl.innerHTML = "";
  for (const s of statuses) {
    const btn = document.createElement("button");
    btn.textContent = s;
    if (s === activeFilter) btn.className = "active";
    btn.onclick = () => { activeFilter = s; renderFilters(); renderRows(); };
    filtersEl.appendChild(btn);
  }
}

function renderRows() {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";
  const filtered = activeFilter === "ALL" ? DATA.invoices : DATA.invoices.filter((i) => i.status === activeFilter);
  for (const inv of filtered) {
    const tr = document.createElement("tr");
    const reason = inv.reviewReason || inv.apiErrorMessage || "";
    const total = inv.totalAmount != null ? inv.totalAmount.toLocaleString() : "-";
    tr.innerHTML =
      "<td>" + inv.fileName + "</td>" +
      "<td><span class=\\"badge " + inv.status + "\\">" + inv.status + "</span></td>" +
      "<td>" + (inv.partnerCode || "-") + "</td>" +
      "<td>" + (inv.invoiceNumber || "-") + "</td>" +
      "<td>" + total + "</td>" +
      "<td>" + (inv.accountingId || "-") + "</td>" +
      "<td class=\\"reason\\">" + reason +
        "<details><summary>line items</summary><pre>" + JSON.stringify(inv.lines, null, 2) + "</pre></details>" +
      "</td>";
    tbody.appendChild(tr);
  }
}

renderFilters();
renderRows();
</script>
</body>
</html>
`;

export function buildHtmlReport(invoices: InvoiceWithLines[]): string {
  const payload = JSON.stringify({ generatedAt: new Date().toISOString(), invoices }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__DATA__", payload);
}
