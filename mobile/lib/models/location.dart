class Location {
  Location({
    required this.id,
    required this.name,
    this.parentId,
    this.photoUrl,
    this.hasPhoto = false,
    this.kind = 'area',
    this.label,
    this.qrToken,
  });

  final String id;
  final String name;

  /// Parent "category" location; null for a top-level location.
  final String? parentId;

  /// Link to a picture of this place (0036); null when there is none.
  final String? photoUrl;

  /// True when a file was uploaded — the bytes come from /locations/:id/photo.
  final bool hasPhoto;

  /// area | shelf | level | box (0041). A box is a labelled container.
  final String kind;

  /// What a box is for ("USB-A to C cables").
  final String? label;

  /// The code on a box's QR sticker; the API assigns it, only boxes have one.
  final String? qrToken;

  bool get isBox => kind == 'box';

  /// "Box · USB-A to C cables" for a box, null for anything else.
  String? get boxBadge => isBox ? ((label?.isNotEmpty ?? false) ? 'Box · $label' : 'Box') : null;

  bool get isTopLevel => parentId == null;

  /// Whether there is any picture at all, however it got here.
  bool get hasAnyPhoto => hasPhoto || (photoUrl?.isNotEmpty ?? false);

  factory Location.fromJson(Map<String, dynamic> json) => Location(
        id: json['id'] as String,
        name: json['name'] as String,
        parentId: json['parent_id'] as String?,
        photoUrl: json['photo_url'] as String?,
        hasPhoto: json['has_photo'] == true,
        kind: (json['kind'] as String?) ?? 'area',
        label: json['label'] as String?,
        qrToken: json['qr_token'] as String?,
      );
}
