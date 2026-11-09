import { LETTERHEAD } from "./letterhead";
import type { DetailedPaymentReportRow } from "@/lib/api/types";

const HEAD = ["Date", "User", "Items", "Amount", "Status", "Location"];

function itemsText(row: DetailedPaymentReportRow): string {
  return row.transaction_products
    .map((p) => (p.sku ? `${p.name} · ${p.sku}` : p.name))
    .join("; ");
}

function bodyForRows(rows: DetailedPaymentReportRow[]): string[][] {
  return rows.map((r) => [
    new Date(r.created_at).toLocaleString(),
    r.profiles.full_name ?? "—",
    itemsText(r) || "—",
    r.amount.toLocaleString(),
    r.status,
    r.locations?.name ?? "—",
  ]);
}

/** `payments-report-2026-08-12.pdf` */
export function paymentsPdfFilename(now: Date): string {
  return `payments-report-${now.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Build and download the detailed payments report.
 *
 * jsPDF is imported here rather than at module scope so it only reaches the
 * browser when someone actually clicks Download PDF.
 */
export async function downloadPaymentsReportPdf(
  rows: DetailedPaymentReportRow[],
  meta: { preparedBy?: string | null } = {},
  now = new Date(),
): Promise<void> {
  // Name the account that generated it, exactly as the condition report does.
  // Falls back to the department only when we cannot name a person.
  const preparedBy = meta.preparedBy?.trim() || LETTERHEAD.preparedBy;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = 44;

  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(LETTERHEAD.org, width / 2, y, { align: "center" });
  y += 16;
  doc.setFont("helvetica", "normal").setFontSize(8);
  const contact = [LETTERHEAD.tel, LETTERHEAD.email].filter(Boolean).join("   ");
  for (const line of [
    LETTERHEAD.departments,
    LETTERHEAD.address,
    contact,
    LETTERHEAD.website,
  ].filter(Boolean)) {
    doc.text(line, width / 2, y, { align: "center" });
    y += 11;
  }

  y += 10;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("DETAILED PAYMENTS REPORT", width / 2, y, { align: "center" });
  y += 18;

  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`Prepared by: ${preparedBy}`, margin, y);
  doc.text(`Date: ${now.toLocaleDateString()}`, width - margin, y, { align: "right" });
  y += 8;

  autoTable(doc, {
    startY: y + 8,
    head: [HEAD],
    body: bodyForRows(rows),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 8 },
    columnStyles: {
      3: { halign: "right" },
    },
  });

  doc.save(paymentsPdfFilename(now));
}
