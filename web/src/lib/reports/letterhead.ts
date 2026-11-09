// Printed on every generated report. Edit here to change it everywhere.
//
// Empty strings are skipped when rendering, so a detail we don't have yet stays
// blank rather than printing a placeholder on a document someone signs.
export const LETTERHEAD = {
  org: "VERLET ROBOTICS",
  departments: "Internal Inventory Management",
  address: "", // e.g. "P.O Box: 0000 Kigali-Rwanda"
  tel: "", // e.g. "Tel: 0000000000"
  email: "Email: rw@verlet.co",
  website: "Website: https://inventory.verlet.co",
  title: "REPORT ON ALL DEVICES AND MATERIALS",
  /** Used only when we cannot name the person who asked for the document. */
  preparedBy: "IT Department",
  // Who signs the paper copy, in order.
  //
  // `who: null` means "the account generating this document" — the renderer
  // fills it with the same name printed as "Prepared by" at the top, so the
  // signature block can never contradict the header.
  approvals: [
    { role: "Prepared By", who: null },
    { role: "Verified by", who: "(Operations)" },
    { role: "Approved by", who: "(Management)" },
  ],
} as const;
