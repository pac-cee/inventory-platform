import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../config/api_client.dart';

/// Printed on every generated report — the mobile mirror of the web's
/// `web/src/lib/reports/letterhead.ts`. Keep the two in step: a report exported
/// from the phone and one exported from the dashboard should be the same paper.
class ReportLetterhead {
  static const org = 'VERLET ROBOTICS';
  static const departments = 'Internal Inventory Management';
  static const email = 'Email: rw@verlet.co';
  static const website = 'Website: https://inventory.verlet.co';
  static const conditionTitle = 'REPORT ON ALL DEVICES AND MATERIALS';

  /// Used only when we cannot name the person who asked for the document.
  static const fallbackPreparedBy = 'IT Department';

  /// Who signs the paper copy, in order. A null `who` is filled with the
  /// account generating the document, so the signature block can never
  /// contradict the "Prepared by" line at the top.
  static const approvals = <({String role, String? who})>[
    (role: 'Prepared By', who: null),
    (role: 'Verified by', who: '(Operations)'),
    (role: 'Approved by', who: '(Management)'),
  ];
}

/// Text the built-in PDF font can actually draw.
///
/// Helvetica here has no glyph for an em dash or a middle dot, and a missing
/// glyph prints as a hollow box — which is what the first mobile export did in
/// the Specification column. Fold them to ASCII rather than ship tofu.
String pdfSafe(String s) => s
    .replaceAll('\u2014', '-')
    .replaceAll('\u2013', '-')
    .replaceAll('\u00b7', '-');

/// One printed line. A heading line introduces an item type that covers
/// several items; it is shaded and bold, exactly as on the web.
class PdfRow {
  const PdfRow(this.cells, {this.heading = false});
  final List<String> cells;
  final bool heading;
}

/// A titled block of rows — one room, with its name above its own table.
class PdfSection {
  const PdfSection({required this.title, required this.rows});
  final String title;
  final List<PdfRow> rows;
}

/// Build a landscape A4 report: letterhead, title, prepared-by/date, one table
/// per section, then the approval block. Returns the PDF bytes ready to share.
Future<Uint8List> buildReportPdf({
  required String title,
  required List<String> head,
  required List<PdfSection> sections,
  /// Column indices to right-align — the numeric ones.
  List<int>? rightAligned,
  DateTime? now,
}) async {
  final at = now ?? DateTime.now();
  final preparedBy = (ApiClient.instance.currentFullName?.trim().isNotEmpty ?? false)
      ? ApiClient.instance.currentFullName!.trim()
      : (ApiClient.instance.currentEmail ?? ReportLetterhead.fallbackPreparedBy);

  final doc = pw.Document();
  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4.landscape,
      margin: const pw.EdgeInsets.all(24),
      header: (context) => context.pageNumber == 1
          ? _letterhead(title, preparedBy, at)
          : pw.SizedBox.shrink(),
      build: (context) => [
        for (final section in sections) ...[
          // Room name above its table, matching the on-screen panel headings.
          if (section.title.isNotEmpty) ...[
            pw.SizedBox(height: 14),
            pw.Text(section.title.toUpperCase(), style: _boldStyle(10)),
            pw.SizedBox(height: 6),
          ],
          pw.TableHelper.fromTextArray(
            headers: head,
            data: [
              for (final r in section.rows) [for (final c in r.cells) pdfSafe(c)],
            ],
            headerStyle: _boldStyle(8, color: PdfColors.white),
            headerDecoration: const pw.BoxDecoration(color: PdfColors.grey800),
            cellStyle: const pw.TextStyle(fontSize: 8),
            cellAlignment: pw.Alignment.centerLeft,
            cellAlignments: rightAligned == null
                ? null
                : {for (final i in rightAligned) i: pw.Alignment.centerRight},
            border: pw.TableBorder.all(color: PdfColors.grey400, width: 0.4),
            // Zebra striping, as on the web, so a wide row is easy to follow.
            oddRowDecoration: const pw.BoxDecoration(color: PdfColors.grey100),
            // A type covering several items is shaded, so the plain lines
            // under it read as its parts rather than separate entries.
            // rowNum counts the header as row 0, hence the -1.
            cellDecoration: (index, data, rowNum) {
              final i = rowNum - 1;
              final isHeading =
                  i >= 0 && i < section.rows.length && section.rows[i].heading;
              return pw.BoxDecoration(
                color: isHeading ? PdfColors.grey300 : null,
              );
            },
          ),
        ],
        pw.SizedBox(height: 24),
        _approvals(preparedBy),
      ],
    ),
  );
  return doc.save();
}

pw.Widget _letterhead(String title, String preparedBy, DateTime at) {
  final date =
      '${at.year}-${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}';
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Center(
        child: pw.Text(ReportLetterhead.org, style: _boldStyle(14)),
      ),
      for (final line in [
        ReportLetterhead.departments,
        ReportLetterhead.email,
        ReportLetterhead.website,
      ])
        pw.Center(child: pw.Text(line, style: const pw.TextStyle(fontSize: 8))),
      pw.SizedBox(height: 10),
      pw.Center(
        child: pw.Text(title.toUpperCase(), style: _boldStyle(11)),
      ),
      pw.SizedBox(height: 8),
      pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text('Prepared by: $preparedBy', style: const pw.TextStyle(fontSize: 9)),
          pw.Text('Date: $date', style: const pw.TextStyle(fontSize: 9)),
        ],
      ),
      pw.SizedBox(height: 10),
    ],
  );
}

pw.Widget _approvals(String preparedBy) {
  return pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.start,
    children: [
      pw.Text('Approval Section', style: _boldStyle(10)),
      pw.SizedBox(height: 12),
      for (final a in ReportLetterhead.approvals)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 18),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              // A null `who` is the operator's row — same name as the header.
              pw.Text('${a.role}: ${a.who ?? preparedBy}',
                  style: const pw.TextStyle(fontSize: 9)),
              pw.Text('Signature: __________________________',
                  style: const pw.TextStyle(fontSize: 9)),
            ],
          ),
        ),
    ],
  );
}

/// Bold text style at a given size — the pdf package's TextStyle is not a const
/// constructor, so this keeps the call sites short without fighting the linter.
pw.TextStyle _boldStyle(double size, {PdfColor? color}) =>
    pw.TextStyle(fontSize: size, fontWeight: pw.FontWeight.bold, color: color);
