import { LETTERHEAD } from "./letterhead";
import {
  groupConditionText,
  groupPercent,
  groupRecommendationText,
  locationsText,
  namePercent,
  nestByName,
  skuText,
  variantsText,
  type GroupedRow,
} from "./condition-group";

/** One printed block: a room, then its categories in order. */
export type PdfGroup = {
  name: string;
  categories: { name: string; items: GroupedRow[] }[];
};

const HEAD = [
  "Category",
  "Item type",
  "Name",
  "Model",
  "SKU",
  "Specification",
  "Location",
  "Quantity",
  "Condition",
  "% Operational",
  "Recommendation",
];

/**
 * One printed line. Heading lines introduce a name that covers several SKUs;
 * they are drawn bold and shaded so the lines beneath read as belonging to it.
 */
export type PdfRow = { cells: string[]; heading: boolean };

/**
 * Table rows for one room, laid out the way the on-screen table is.
 *
 * A name stocked under several SKUs used to print once per SKU, repeating the
 * name down the page as if they were unrelated entries. Now the name is
 * written once with the combined total, and each SKU keeps its own line and
 * its own numbers below it — different SKUs are still different items.
 *
 * Category is written once per block, as on paper.
 */
export function bodyForGroup(group: PdfGroup): PdfRow[] {
  const out: PdfRow[] = [];
  for (const cat of group.categories) {
    nestByName(cat.items).forEach((nameGroup, gi) => {
      const multi = nameGroup.lines.length > 1;
      if (multi) {
        out.push({
          heading: true,
          cells: [
            gi === 0 ? cat.name : "",
            nameGroup.name,
            nameGroup.lines.map((l) => l.name).join(" · "),
            nameGroup.lines.map((l) => l.model).join(" · "),
            nameGroup.lines.map(skuText).join(" · "),
            "",
            "",
            String(nameGroup.total),
            "",
            `${namePercent(nameGroup)} %`,
            "",
          ],
        });
      }
      for (const r of nameGroup.lines) {
        out.push({
          heading: false,
          // Under a heading the name is left blank — the SKU column carries
          // the distinction, and the gap is what makes the nesting visible.
          cells: [
            !multi && gi === 0 ? cat.name : "",
            multi ? "" : r.type,
            r.name,
            r.model,
            skuText(r),
            variantsText(r),
            locationsText(r),
            String(r.total),
            groupConditionText(r),
            `${groupPercent(r)} %`,
            groupRecommendationText(r) || "—",
          ],
        });
      }
    });
  }
  return out;
}

/** `condition-report-2026-08-06.pdf` */
export function pdfFilename(now: Date): string {
  return `condition-report-${now.toISOString().slice(0, 10)}.pdf`;
}

/** Who asked for the document, and when it was made. */
export type PdfMeta = {
  /** The signed-in person. Falls back to the department when we have no name. */
  preparedBy?: string | null;
  now?: Date;
};

/**
 * Build and download the condition report.
 *
 * jsPDF is imported here rather than at module scope so it only reaches the
 * browser when someone actually clicks Download PDF.
 */
export async function downloadConditionPdf(groups: PdfGroup[], meta: PdfMeta = {}): Promise<void> {
  const now = meta.now ?? new Date();
  const preparedBy = meta.preparedBy?.trim() || LETTERHEAD.preparedBy;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = 44;

  // Letterhead, centred.
  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(LETTERHEAD.org, width / 2, y, { align: "center" });
  y += 16;
  doc.setFont("helvetica", "normal").setFontSize(8);
  // Blank fields are skipped so the block closes up instead of leaving gaps.
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
  doc.text(LETTERHEAD.title, width / 2, y, { align: "center" });
  y += 18;

  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`Prepared by: ${preparedBy}`, margin, y);
  doc.text(`Date: ${now.toLocaleDateString()}`, width - margin, y, { align: "right" });
  y += 8;

  for (const group of groups) {
    // Room name above its table, matching the on-screen panel headings.
    y += 26;
    if (y > doc.internal.pageSize.getHeight() - margin - 80) {
      doc.addPage();
      y = margin + 20;
    }
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text(group.name.toUpperCase(), margin, y);

    const rows = bodyForGroup(group);
    const headings = new Set(rows.flatMap((r, i) => (r.heading ? [i] : [])));

    autoTable(doc, {
      startY: y + 8,
      head: [HEAD],
      body: rows.map((r) => r.cells),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 8 },
      // A name covering several SKUs is shaded and bold, so the plain lines
      // under it read as its parts rather than as separate entries.
      didParseCell: (data) => {
        if (data.section === "body" && headings.has(data.row.index)) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [232, 232, 232];
        }
      },
      // Numbers get fixed narrow columns; the prose columns take what is left.
      columnStyles: {
        0: { cellWidth: 66 },
        2: { cellWidth: 64 },
        3: { cellWidth: 54 },
        4: { cellWidth: 62 },
        5: { cellWidth: 80 },
        6: { cellWidth: 72 },
        7: { cellWidth: 40, halign: "right" },
        9: { cellWidth: 50, halign: "right" },
        10: { cellWidth: 90 },
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }

  approvalBlock(doc, margin, width, y, preparedBy);
  doc.save(pdfFilename(now));
}

/** Signature lines. Pushed to a new page if it would not fit. */
function approvalBlock(
  doc: import("jspdf").jsPDF,
  margin: number,
  width: number,
  y: number,
  preparedBy: string,
): void {
  const needed = 30 + LETTERHEAD.approvals.length * 34;
  let top = y + 28;
  if (top + needed > doc.internal.pageSize.getHeight() - margin) {
    doc.addPage();
    top = margin + 20;
  }

  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text("Approval Section", margin, top);
  top += 20;

  doc.setFont("helvetica", "normal").setFontSize(9);
  for (const a of LETTERHEAD.approvals) {
    // A null `who` is the operator's row — same name as the header line.
    doc.text(`${a.role}: ${a.who ?? preparedBy}`, margin, top);
    doc.text("Signature: __________________________", width / 2, top);
    top += 34;
  }
}
