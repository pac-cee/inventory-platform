/// What a box's QR sticker says — the same family as the item code
/// (`inventory:item:<id>`), so one scanner reads both: `inventory:box:<code>`.
///
/// The code is the one the API assigned when the location became a box (ten
/// characters, no I, L, O or U). It never changes, so a printed label stays valid.
const _prefix = 'inventory:box:';
final _code = RegExp(r'^[0-9A-HJKMNP-TV-Z]{10}$');

String boxQrData(String token) => '$_prefix$token';

/// The box code in a scanned value, or null for anything that is not a box code.
String? parseBoxQr(String raw) {
  final v = raw.trim();
  if (!v.toLowerCase().startsWith(_prefix)) return null;
  final token = v.substring(_prefix.length).trim().toUpperCase();
  return _code.hasMatch(token) ? token : null;
}
