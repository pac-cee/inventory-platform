/// The store is laid out  Area > Shelf > Level > Box.  A box is always the last
/// step: it sits on a level and holds nothing below it (stock lives in the box).
/// The server enforces the same rules; this only keeps the screens from offering
/// choices it would refuse.
library;

/// What may be created INSIDE a place of kind [parentKind] (null = at the top).
List<String> kindsAllowedUnder(String? parentKind) {
  switch (parentKind) {
    case null:
      return const ['area'];
    case 'area':
      return const ['shelf'];
    case 'shelf':
      return const ['level'];
    case 'level':
      return const ['box'];
    default: // a box holds nothing below it
      return const [];
  }
}

/// Whether "add a sub-location here" makes sense for a place of this kind.
bool canHoldSubLocations(String kind) => kindsAllowedUnder(kind).isNotEmpty;

String kindLabel(String kind) => switch (kind) {
      'area' => 'Area / room',
      'shelf' => 'Shelf',
      'level' => 'Level',
      'box' => 'Box (container)',
      _ => kind,
    };

/// A short name for button text: "Shelf", "Level", "Box"…
String kindWord(String kind) => switch (kind) {
      'area' => 'Area',
      'shelf' => 'Shelf',
      'level' => 'Level',
      'box' => 'Box',
      _ => kind,
    };

/// An example name for the form's hint.
String kindHint(String kind) => switch (kind) {
      'area' => 'e.g. Warehouse A',
      'shelf' => 'e.g. Shelf 3',
      'level' => 'e.g. Level 2',
      'box' => 'e.g. Box 12',
      _ => 'Name',
    };

/// What to offer in the Type menu when editing a place that already is
/// [current], sitting under [parentKind]: what fits there, and always itself, so
/// an older place that does not follow the layout can still be opened and saved.
List<String> kindsForEdit(String current, String? parentKind) {
  final fits = kindsAllowedUnder(parentKind);
  return [...fits, if (!fits.contains(current)) current];
}

/// A place made before places had types: stored as "area" although it sits inside a shelf, a
/// level or a box. (An area inside another AREA is fine: a "Shelves" grouping inside a room.)
/// Marks the old ones for the "set what this place is" nudge.
bool isOlderUntypedPlace(String kind, String? parentKind) =>
    kind == 'area' && parentKind != null && parentKind != 'area';
