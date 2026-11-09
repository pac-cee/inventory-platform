import 'config/api_client.dart';
import 'config/paging.dart';
import 'models.dart';

/// All inventory data access, going through [ApiClient] (so every call carries
/// the user's token and respects the backend's RLS rules).
class InventoryRepository {
  const InventoryRepository();

  /// The whole catalog, however many pages that takes — see config/paging.dart
  /// for why one request is not enough.
  Future<List<Item>> fetchItems({String? search}) async {
    final query = (search == null || search.isEmpty)
        ? ''
        : '&search=${Uri.encodeQueryComponent(search)}';
    return fetchAllPages((limit, offset) async {
      final data = await api.get('/items?limit=$limit&offset=$offset$query') as List<dynamic>;
      return data.map((e) => Item.fromJson(e as Map<String, dynamic>)).toList();
    });
  }

  /// One page of matches for a search-as-you-type box. (fetchItems pages through
  /// EVERYTHING, which is right for a screen that needs the catalog, not for a
  /// keystroke.)
  Future<List<Item>> searchItems(String query, {int limit = 30}) async {
    final data = await api.get('/items?limit=$limit&search=${Uri.encodeQueryComponent(query)}') as List<dynamic>;
    return data.map((e) => Item.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// How many of each item are on a shelf and in which places — what a search
  /// result needs to answer "do we have it, and which box?".
  Future<Map<String, ItemWhere>> fetchWhere(List<String> itemIds) async {
    if (itemIds.isEmpty) return {};
    final data = await api.get('/items/where?ids=${itemIds.join(',')}') as List<dynamic>;
    return {
      for (final e in data) (e as Map<String, dynamic>)['item_id'] as String: ItemWhere.fromJson(e),
    };
  }

  /// A scanned box code → the box's location id (the API does the lookup).
  /// Throws ApiException(404) for a code no box has.
  Future<String> fetchBoxLocationId(String token) async {
    final data = await api.get('/locations/by-token/$token') as Map<String, dynamic>;
    return (data['location'] as Map<String, dynamic>)['id'] as String;
  }

  Future<Item> fetchItem(String id) async {
    final data = await api.get('/items/$id') as Map<String, dynamic>;
    return Item.fromJson(data);
  }

  Future<List<StockLevel>> fetchStock() async {
    final data = await api.get('/stock') as List<dynamic>;
    return data.map((e) => StockLevel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<StockLevel>> fetchItemStock(String itemId) async {
    final data = await api.get('/items/$itemId/stock') as List<dynamic>;
    return data.map((e) => StockLevel.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Who currently holds this item (net checked out), from the movement ledger.
  Future<List<Holder>> fetchHolders(String itemId) async {
    final data = await api.get('/items/$itemId/holders') as List<dynamic>;
    return data.map((e) => Holder.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<StockLevel>> fetchStockAtLocation(String locationId) async {
    final data = await api.get('/stock?location_id=$locationId') as List<dynamic>;
    return data.map((e) => StockLevel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<Location>> fetchLocations() async {
    final data = await api.get('/locations') as List<dynamic>;
    return data.map((e) => Location.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Location> fetchLocation(String id) async {
    final data = await api.get('/locations/$id') as Map<String, dynamic>;
    return Location.fromJson(data);
  }

  Future<List<Movement>> fetchMovements(String itemId) async {
    final data = await api.get('/movements?item_id=$itemId') as List<dynamic>;
    return data.map((e) => Movement.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Relocate an item's ENTIRE presence from one location to another (admin) —
  /// all units (accessible, damaged, checked-out) and its total move, and the
  /// item is removed from the source location.
  Future<void> transferStock({
    required String itemId,
    required String fromLocationId,
    required String toLocationId,
  }) =>
      api.post('/movements/transfer', {
        'item_id': itemId,
        'from_location_id': fromLocationId,
        'to_location_id': toLocationId,
      });

  /// Move [quantity] units of an item from one location to another (admin).
  /// Only units on the shelf move; damaged units and anything checked out stay
  /// put. The total travels with them, so the item's grand total is unchanged —
  /// use [adjustStock] to actually add or remove units.
  Future<void> moveStockBetween({
    required String itemId,
    required String fromLocationId,
    required String toLocationId,
    required int quantity,
  }) =>
      api.post('/movements/transfer', {
        'item_id': itemId,
        'from_location_id': fromLocationId,
        'to_location_id': toLocationId,
        'quantity': quantity,
      });

  /// Relocate several items in one go (admin) — the batch behind a multi-select
  /// drag. Each item moves independently; returns how many actually moved and
  /// the reason the rest didn't.
  Future<({int moved, List<String> failures})> transferStockMany({
    required List<String> itemIds,
    required String fromLocationId,
    required String toLocationId,
  }) async {
    if (itemIds.length == 1) {
      await transferStock(
        itemId: itemIds.first,
        fromLocationId: fromLocationId,
        toLocationId: toLocationId,
      );
      return (moved: 1, failures: const <String>[]);
    }
    final data = await api.post('/movements/transfer', {
      'item_ids': itemIds,
      'from_location_id': fromLocationId,
      'to_location_id': toLocationId,
    }) as Map<String, dynamic>;
    final failed = (data['failed'] as List<dynamic>? ?? const [])
        .map((e) => (e as Map<String, dynamic>)['message'] as String? ?? 'Could not move this item.')
        .toList();
    return (moved: (data['moved'] as num?)?.toInt() ?? 0, failures: failed);
  }

  /// Admin activity report: a filtered read over the movement ledger with
  /// enriched rows + summary rollups.
  Future<ActivityReport> fetchActivityReport(ReportFilters filters) async {
    final qs = filters.toQuery();
    final data = await api.get('/movements/report${qs.isEmpty ? '' : '?$qs'}') as Map<String, dynamic>;
    return ActivityReport.fromJson(data);
  }

  /// Move stock. `action` is take | return | finish | destroy | lost | repair.
  /// take/return move stock; destroy marks damaged (kept in the total); finish
  /// consumes it. `damagedBy` (destroy/lost only, admin) attributes it to a
  /// holder — it then comes out of their checked-out count.
  ///
  /// `note` is REQUIRED by the API for destroy/lost: it says what is wrong, and
  /// the condition report is a tally of exactly those words. `recommendation`
  /// says what to do about it. `resolves` (repair only) names the fault being
  /// cleared, so the report's condition sentence loses the right clause.
  Future<void> moveStock({
    required String itemId,
    required String locationId,
    required int quantity,
    required String action,
    String? damagedBy,
    String? note,
    String? recommendation,
    String? resolves,
    String? expectedReturnAt,
    String? onBehalfOf,
  }) async {
    const endpoints = {
      'take': '/movements/check-out',
      'return': '/movements/check-in',
      'finish': '/movements/finish',
      'destroy': '/movements/destroy',
      'lost': '/movements/lost',
      'repair': '/movements/repair',
    };
    await api.post(endpoints[action]!, {
      'item_id': itemId,
      'location_id': locationId,
      'quantity': quantity,
      if ((action == 'destroy' || action == 'lost') && damagedBy != null) 'damaged_by': damagedBy,
      if (note != null && note.isNotEmpty) 'note': note,
      if (recommendation != null && recommendation.isNotEmpty) 'recommendation': recommendation,
      if (action == 'repair' && resolves != null) 'resolves': resolves,
      // Take only: when the person expects to bring it back (ISO).
      if (action == 'take' && expectedReturnAt != null) 'expected_return_at': expectedReturnAt,
      // Managers only: record a take/return for someone else.
      if ((action == 'take' || action == 'return') && onBehalfOf != null) 'on_behalf_of': onBehalfOf,
    });
  }

  /// Outstanding loans of an item — who holds it and when it is due back.
  Future<List<Loan>> fetchBorrowed(String itemId) async {
    final data = await api.get('/movements/borrowed?item_id=$itemId') as List<dynamic>;
    return data.map((e) => Loan.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Everyone's outstanding loans (managers only — the API gives a member just their own).
  Future<List<Loan>> fetchAllLoans() async {
    final data = await api.get('/movements/borrowed') as List<dynamic>;
    return data.map((e) => Loan.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// The signed-in person's own loans (a manager's plain list would be everyone's).
  Future<List<Loan>> fetchMyLoans() async {
    final me = api.currentUserId;
    final data = await api.get('/movements/borrowed${me == null ? '' : '?user_id=$me'}') as List<dynamic>;
    return data.map((e) => Loan.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Reservations for an item that are still standing (upcoming or active). Members
  /// get their own; managers get everyone's.
  Future<List<Reservation>> fetchReservations(String itemId) async {
    final data = await api.get('/reservations?item_id=$itemId') as List<dynamic>;
    return data.map((e) => Reservation.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Hold [quantity] units at a location for a window. Managers may pass
  /// [forUserId] to reserve for someone else.
  Future<void> reserve({
    required String itemId,
    required String locationId,
    required int quantity,
    required String startsAt,
    required String endsAt,
    String? note,
    String? forUserId,
  }) async {
    await api.post('/reservations', {
      'item_id': itemId,
      'location_id': locationId,
      'quantity': quantity,
      'starts_at': startsAt,
      'ends_at': endsAt,
      if (note != null && note.isNotEmpty) 'note': note,
      if (forUserId != null) 'for_user_id': forUserId,
    });
  }

  Future<void> cancelReservation(String id) async {
    await api.post('/reservations/$id/cancel');
  }

  /// Change when a loan is due back (the holder, or a manager).
  Future<void> extendLoan(String takeId, String expectedReturnAtIso) async {
    await api.post('/movements/$takeId/extend', {'expected_return_at': expectedReturnAtIso});
  }

  /// Outstanding faults for an item at a location — what is currently wrong
  /// with the damaged units. Feeds the repair sheet's "which one did you fix?".
  Future<List<Fault>> fetchFaults({
    required String itemId,
    required String locationId,
  }) async {
    final data = await api
        .get('/movements/faults?item_id=$itemId&location_id=$locationId') as List<dynamic>;
    return data.map((e) => Fault.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// The condition report: current state per item and location, grouped by room
  /// and category. Admin-only on the API.
  Future<List<ConditionRow>> fetchConditionReport({
    String? locationId,
    String? category,
    bool faultyOnly = false,
  }) async {
    final params = <String>[
      if (locationId != null) 'location_id=$locationId',
      if (category != null) 'category=${Uri.encodeQueryComponent(category)}',
      if (faultyOnly) 'faulty_only=true',
    ];
    final qs = params.isEmpty ? '' : '?${params.join('&')}';
    final data = await api.get('/reports/condition$qs') as List<dynamic>;
    return data.map((e) => ConditionRow.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Categories already in use, for the item form's suggestions.
  Future<List<String>> fetchCategories() async {
    final data = await api.get('/reports/categories') as List<dynamic>;
    return data.map((e) => e as String).toList();
  }

  /// Admin: set the current quantity and/or total (ceiling) at a location.
  Future<void> adjustStock({
    required String itemId,
    required String locationId,
    required int quantity,
    required int capacity,
  }) =>
      api.post('/movements/adjust', {
        'item_id': itemId,
        'location_id': locationId,
        'quantity': quantity,
        'capacity': capacity,
      });

  /// Undo a finish/destroyed movement (own entry, or any as admin).
  Future<void> undoMovement(String movementId) =>
      api.post('/movements/$movementId/undo', const {});

  /// Admin: toggle whether an item can be finished.
  Future<void> setFinishable(String itemId, bool finishable) =>
      api.patch('/items/$itemId', {'finishable': finishable});

  /// Admin: edit an item's core details (type/name/model/specification) — e.g.
  /// to fix a naming mistake. A blank specification clears that field. The SKU
  /// is not sent: the API assigns it, and reissues it if the type changes.
  Future<void> updateItem(
    String id, {
    required String type,
    required String name,
    required String model,
    String? specification,
    String? category,
    int? unitsPerContainer,
  }) =>
      api.patch('/items/$id', {
        'type': type,
        'name': name,
        'model': model,
        'specification': (specification != null && specification.isNotEmpty) ? specification : null,
        'category': (category != null && category.isNotEmpty) ? category : null,
        if (unitsPerContainer != null) 'units_per_container': unitsPerContainer,
      });

  /// Admin: change how an existing item is counted — plain units, a container
  /// holding [unitsPerContainer] units (a "box" item), or whole packages.
  ///
  /// Quantities are never rewritten. Switching to/from containers only changes
  /// how the same unit counts are displayed ("2 boxes (24 units)"); switching to
  /// packages makes the existing numbers mean package counts, which the caller
  /// should warn about.
  Future<void> setItemPackaging(
    String id, {
    required String mode, // units | container | package
    int? unitsPerContainer,
    String? containerLabel,
    String? packageLabel,
  }) =>
      api.patch('/items/$id/packaging', {
        'mode': mode,
        if (mode == 'container') ...{
          'units_per_container': unitsPerContainer,
          'container_label': containerLabel,
        },
        if (mode == 'package') 'package_label': packageLabel,
      });

  /// Create a catalog item and seed its initial stock at a location.
  Future<void> createItem({
    required String type,
    required String name,
    required String model,
    String? specification,
    String? category,
    int unitsPerContainer = 1,
    String? packageLabel,
    required String locationId,
    required int quantity,
    bool finishable = false,
    String? photoUrl,
    String? photoData,
  }) async {
    final isPackage = packageLabel != null && packageLabel.isNotEmpty;
    final item = await api.post('/items', {
      'type': type,
      'name': name,
      'model': model,
      // No 'sku' — the API assigns it from the type.
      'specification': (specification != null && specification.isNotEmpty) ? specification : null,
      'category': (category != null && category.isNotEmpty) ? category : null,
      // Packages ignore units_per_container (quantity is a package count).
      'units_per_container': isPackage ? 1 : unitsPerContainer,
      'package_label': isPackage ? packageLabel : null,
      'finishable': finishable,
      'photo_url': (photoUrl != null && photoUrl.isNotEmpty) ? photoUrl : null,
      // An uploaded image wins over a link; only one is ever sent.
      if (photoData != null && photoData.isNotEmpty) 'photo_data': photoData,
    }) as Map<String, dynamic>;

    await api.post('/movements', {
      'item_id': item['id'],
      'location_id': locationId,
      'delta': quantity,
      'reason': 'initial',
      'note': 'Initial stock',
    });
  }

  Future<void> deleteItem(String id) => api.delete('/items/$id');

  /// Register a catalog item without seeding stock (mirrors web "Quick Register").
  Future<Item> registerCatalogItem({
    required String type,
    required String name,
    required String model,
    String? specification,
    String? category,
    bool finishable = false,
    int? unitsPerContainer,
    String? packageLabel,
  }) async {
    final data = await api.post('/items', {
      'type': type,
      'name': name,
      'model': model,
      if (specification != null && specification.isNotEmpty) 'specification': specification,
      if (category != null && category.isNotEmpty) 'category': category,
      'finishable': finishable,
      if (unitsPerContainer != null) 'units_per_container': unitsPerContainer,
      if (packageLabel != null && packageLabel.isNotEmpty) 'package_label': packageLabel,
    }) as Map<String, dynamic>;
    return Item.fromJson(data);
  }

  /// Create a location, optionally nested under a parent "category" (top-level
  /// location). Pass [parentId] null for a top-level location.
  /// A picture can ride along with the location (0036), the same two ways an
  /// item's can: a link, or an uploaded file as `data:image/jpeg;base64,...`.
  Future<void> createLocation(
    String name, {
    String? parentId,
    String? photoUrl,
    String? photoData,
    String? kind,
    String? label,
  }) =>
      api.post('/locations', {
        'name': name,
        'parent_id': parentId,
        if (kind != null) 'kind': kind,
        // A label only means something for a box.
        if (kind != null) 'label': kind == 'box' && (label?.isNotEmpty ?? false) ? label : null,
        'photo_url': (photoUrl != null && photoUrl.isNotEmpty) ? photoUrl : null,
        if (photoData != null && photoData.isNotEmpty) 'photo_data': photoData,
      });

  /// Admin: rename a location and/or change its parent. Pass [parentId] null to
  /// make it top-level. Only provided fields are sent.
  ///
  /// [clearPhotoData] drops a stored upload — needed when switching to a link,
  /// because the API prefers the upload and the new link would never be seen.
  Future<void> updateLocation(
    String id, {
    String? name,
    String? parentId,
    bool setParent = false,
    String? photoUrl,
    bool clearPhotoData = false,
    String? kind,
    String? label,
  }) =>
      api.patch('/locations/$id', {
        if (name != null) 'name': name,
        if (kind != null) 'kind': kind,
        if (kind != null) 'label': kind == 'box' && (label?.isNotEmpty ?? false) ? label : null,
        if (setParent) 'parent_id': parentId,
        if (photoUrl != null) 'photo_url': photoUrl.isEmpty ? null : photoUrl,
        if (clearPhotoData) 'photo_data': null,
      });

  /// Store an uploaded photo for a location. [dataUrl] is `data:image/...`.
  Future<void> uploadLocationPhoto(String locationId, String dataUrl) async {
    await api.put('/locations/$locationId/photo', {'data_url': dataUrl});
  }

  /// Remove a location's uploaded photo. Any photo_url link is left alone.
  Future<void> removeLocationPhoto(String locationId) async {
    await api.delete('/locations/$locationId/photo');
  }

  /// Remove a location (admin). The API refuses with a specific reason while it
  /// still has sub-locations or holds stock, and archives instead of deleting
  /// when there's ledger history to preserve — returning a message to show.
  Future<String?> deleteLocation(String id) async {
    final data = await api.delete('/locations/$id');
    return (data is Map<String, dynamic>) ? data['message'] as String? : null;
  }
}

/// Profile + account management (admin-only operations are gated server-side).
class UsersRepository {
  const UsersRepository();

  Future<List<Profile>> fetchProfiles() async {
    final data = await api.get('/profiles') as List<dynamic>;
    return data.map((e) => Profile.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Change a user's role (admin-only, enforced server-side). Returns the
  /// updated profile from the API so the UI can reflect it without re-fetching
  /// (a re-fetch can be served stale from the browser's HTTP cache on web).
  Future<Profile> changeRole(String id, String role) async {
    final data = await api.patch('/profiles/$id/role', {'role': role}) as Map<String, dynamic>;
    return Profile.fromJson(data);
  }

  /// Block or unblock a user (admin-only, enforced server-side).
  Future<void> setBlocked(String id, bool blocked) =>
      api.patch('/users/$id/block', {'blocked': blocked});

  /// Leave [password] blank and the API emails a set-password link instead,
  /// which also confirms the address is real. Returns true when it did.
  Future<bool> createUser({
    required String email,
    String? password,
    String? fullName,
    required String role,
  }) async {
    final res = await api.post('/users', {
        'email': email,
        if (password != null && password.isNotEmpty) 'password': password,
        if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
        'role': role,
      }) as Map<String, dynamic>;
    return res['invited'] == true;
  }

  /// Edit another user's account as an admin: display name, email, and/or
  /// password (for fixing things when the user can't themselves). Only the
  /// provided fields are sent. Admin-only + service-role key, enforced
  /// server-side. Returns the updated profile.
  Future<Profile> updateUser(
    String id, {
    String? fullName,
    String? email,
    String? password,
  }) async {
    final body = <String, dynamic>{
      if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
      if (email != null && email.isNotEmpty) 'email': email,
      if (password != null && password.isNotEmpty) 'password': password,
    };
    final data = await api.patch('/users/$id', body) as Map<String, dynamic>;
    return Profile.fromJson(data);
  }

  Future<void> deleteUser(String id) => api.delete('/users/$id');
}

extension ItemPhotoApi on InventoryRepository {
  /// Store an uploaded photo. [dataUrl] is `data:image/jpeg;base64,...`.
  Future<void> uploadItemPhoto(String itemId, String dataUrl) async {
    await ApiClient.instance.put('/items/$itemId/photo', {'data_url': dataUrl});
  }

  /// Remove an uploaded photo. Any photo_url link on the item is left alone.
  Future<void> removeItemPhoto(String itemId) async {
    await ApiClient.instance.delete('/items/$itemId/photo');
  }

  /// Set or clear the external photo link.
  Future<void> setItemPhotoUrl(String itemId, String? url) async {
    await ApiClient.instance.patch('/items/$itemId', {'photo_url': url});
  }
}

/// A change worth making to an item that still works — an upgrade, a service.
/// Raising one moves no stock.
class Suggestion {
  const Suggestion({
    required this.id,
    required this.itemId,
    required this.note,
    required this.kind,
    this.units,
    this.locationName = '',
    this.createdByName = '',
    this.createdBy,
  });

  final String id;
  final String itemId;
  final String note;
  final String kind;
  final int? units;
  final String locationName;
  final String createdByName;
  final String? createdBy;

  static Suggestion fromJson(Map<String, dynamic> j) => Suggestion(
        id: j['id'] as String,
        itemId: j['item_id'] as String,
        note: j['note'] as String,
        kind: j['kind'] as String? ?? 'upgrade',
        units: j['units'] as int?,
        locationName: j['location_name'] as String? ?? '',
        createdByName: j['created_by_name'] as String? ?? '',
        createdBy: j['created_by'] as String?,
      );
}

extension SuggestionsApi on InventoryRepository {
  /// Open suggestions for an item.
  Future<List<Suggestion>> fetchSuggestions(String itemId) async {
    final list = await ApiClient.instance.get('/suggestions?item_id=$itemId') as List<dynamic>;
    return list.map((e) => Suggestion.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Raise a suggestion. Any signed-in user.
  Future<void> addSuggestion({
    required String itemId,
    required String note,
    String kind = 'upgrade',
    String? locationId,
    int? units,
  }) async {
    await ApiClient.instance.post('/suggestions', {
      'item_id': itemId,
      'note': note,
      'kind': kind,
      'location_id': locationId,
      'units': units,
    });
  }

  /// Close a suggestion. Admin only.
  Future<void> resolveSuggestion(String id, {String? resolution}) async {
    await ApiClient.instance.post('/suggestions/$id/resolve', {
      if (resolution != null && resolution.isNotEmpty) 'resolution': resolution,
    });
  }

  /// Withdraw a suggestion. The author, or an admin.
  Future<void> removeSuggestion(String id) async {
    await ApiClient.instance.delete('/suggestions/$id');
  }
}
