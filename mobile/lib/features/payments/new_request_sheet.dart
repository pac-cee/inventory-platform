import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../repository.dart';
import 'draft_store.dart';

class PaymentDraft {
  const PaymentDraft({
    this.paymentMethod = 'momo',
    this.phone = '',
    this.recipientName = '',
    this.bankAccountNumber,
    this.bankAccountName,
    this.tinNumber,
    this.locationId,
    this.products = const [],
    this.submitted = false,
  });
  final String paymentMethod; // 'momo' | 'bk'
  final String phone;

  /// Who a Bank of Kigali phone payment is for (UrubutoPay needs a name with the number).
  final String recipientName;
  final String? bankAccountNumber;
  final String? bankAccountName;
  final String? tinNumber;
  final String? locationId;
  final List<PaymentProduct> products;
  final bool submitted;
  bool get hasItems => products.isNotEmpty;
}

String _commaFormat(double n) {
  final s = n.round().toString();
  final buf = StringBuffer();
  int count = 0;
  for (int i = s.length - 1; i >= 0; i--) {
    if (count > 0 && count % 3 == 0) buf.write(',');
    buf.write(s[i]);
    count++;
  }
  return buf.toString().split('').reversed.join();
}

String formatRwf(double n) => 'RWF ${_commaFormat(n)}';
String formatNum(double n) => _commaFormat(n);

class NewRequestSheet extends StatefulWidget {
  const NewRequestSheet({super.key, this.draft, this.resume});
  final PaymentDraft? draft;

  /// A form recovered after Android killed the app during the camera. Wins
  /// over [draft]: it holds everything, including the half-filled product.
  final RequestSnapshot? resume;

  @override
  State<NewRequestSheet> createState() => _NewRequestSheetState();
}

class _NewRequestSheetState extends State<NewRequestSheet> {
  final _inventory = const InventoryRepository();
  final ImagePicker _picker = ImagePicker();

  String _paymentMethod = 'momo'; // 'momo' | 'bk'
  // BK covers two patterns: paying an employee's phone (the common case,
  // shown by default) or a vendor's bank account (opt-in via this toggle).
  bool _bkPayToBankAccount = false;
  final _phoneCtrl = TextEditingController();
  final _recipientNameCtrl = TextEditingController();
  final _bankAccountNoCtrl = TextEditingController();
  final _bankAccountNameCtrl = TextEditingController();
  final _tinCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _typeCtrl = TextEditingController();
  final _modelCtrl = TextEditingController();
  final _descCtrl = TextEditingController(); // holds the specification
  final _qtyCtrl = TextEditingController(text: '1');
  final _priceCtrl = TextEditingController();

  // Catalog metadata for a not-in-catalog product — only meaningful when
  // Quick Register creates a brand-new item (mirrors Add Item).
  final _categoryCtrl = TextEditingController();
  List<String> _categories = [];
  bool _finishable = false;
  String _countMode = 'units'; // 'units' | 'package'
  final _unitsPerContainerCtrl = TextEditingController(text: '1');
  final _packageLabelCtrl = TextEditingController(text: 'package');

  List<Location> _locations = [];
  List<Item> _catalog = [];
  List<StockLevel> _stock = [];
  String? _locationId;
  // The chain of chosen locations (root -> deepest) for the cascading picker.
  List<String> _locPath = [];
  final List<PaymentProduct> _cart = [];

  bool _isCustomProduct = false; // false = pick from catalog; true = free-form
  // Tracks which catalog item is currently picked, so the auto-selected
  // location hint below can explain itself (name alone can't disambiguate
  // two items that share a name but differ by SKU).
  Item? _pickedCatalogItem;
  String? _itemPhotoBase64;
  bool _loadingLocs = true;
  bool _loadingCatalog = true;
  bool _registering = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final d = widget.draft;
    if (d != null) {
      _paymentMethod = d.paymentMethod;
      _phoneCtrl.text = d.phone;
      _recipientNameCtrl.text = d.recipientName;
      _bankAccountNoCtrl.text = d.bankAccountNumber ?? '';
      _bankAccountNameCtrl.text = d.bankAccountName ?? '';
      _tinCtrl.text = d.tinNumber ?? '';
      _bkPayToBankAccount = (d.bankAccountNumber ?? '').isNotEmpty;
      _locationId = d.locationId;
      _cart.addAll(d.products);
    }
    final resume = widget.resume;
    if (resume != null) _applySnapshot(resume);
    _loadLocations();
    _loadCatalogAndStock();
    // Best-effort: the category field still works as plain text if this fails.
    _inventory.fetchCategories().then((c) {
      if (mounted) setState(() => _categories = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _recipientNameCtrl.dispose();
    _bankAccountNoCtrl.dispose();
    _bankAccountNameCtrl.dispose();
    _tinCtrl.dispose();
    _nameCtrl.dispose();
    _typeCtrl.dispose();
    _modelCtrl.dispose();
    _descCtrl.dispose();
    _qtyCtrl.dispose();
    _priceCtrl.dispose();
    _categoryCtrl.dispose();
    _unitsPerContainerCtrl.dispose();
    _packageLabelCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadLocations() async {
    try {
      final locs = await _inventory.fetchLocations();
      if (!mounted) return;
      setState(() {
        _locations = locs;
        _loadingLocs = false;
        _syncPathFromLeaf(); // restore picker path if a draft set a leaf
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loadingLocs = false;
      });
    }
  }

  Future<void> _loadCatalogAndStock() async {
    try {
      final results = await Future.wait([
        _inventory.fetchItems(),
        _inventory.fetchStock(),
      ]);
      if (!mounted) return;
      setState(() {
        _catalog = results[0] as List<Item>;
        _stock = results[1] as List<StockLevel>;
        _loadingCatalog = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loadingCatalog = false;
      });
    }
  }

  /// Web parity: when a catalog item is picked, auto-fill description and
  /// auto-select the location with the highest quantity of that item.
  String? _autoLocationForItem(Item? item) {
    if (item == null) return null;
    final entries = _stock.where((s) => s.itemId == item.id).toList();
    if (entries.isEmpty) return null;
    final best = entries.reduce((a, b) => a.quantity >= b.quantity ? a : b);
    return best.locationId;
  }

  /// Explains why a location was (or wasn't) auto-selected for the picked
  /// catalog item — replaces silently falling back with no explanation.
  Widget _buildAutoSelectHint() {
    final item = _pickedCatalogItem;
    if (item == null) return const SizedBox.shrink();
    final entries = _stock.where((s) => s.itemId == item.id).toList();
    if (entries.isEmpty) {
      return const Padding(
        padding: EdgeInsets.only(top: 4),
        child: Text(
          'No current stock recorded for this item — pick a location manually.',
          style: TextStyle(fontSize: 11, color: Color(0xFFF59E0B)),
        ),
      );
    }
    final best = entries.reduce((a, b) => a.quantity >= b.quantity ? a : b);
    if (best.locationId != _locationId) return const SizedBox.shrink();
    Location? loc;
    for (final l in _locations) {
      if (l.id == best.locationId) {
        loc = l;
        break;
      }
    }
    if (loc == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        'Auto-selected: ${loc.name} — ${best.quantity} in stock',
        style: const TextStyle(fontSize: 11, color: Color(0xFF22C55E)),
      ),
    );
  }

  void _onCatalogPicked(Item? item) {
    setState(() {
      _nameCtrl.text = item?.name ?? '';
      _typeCtrl.text = item?.type ?? '';
      _modelCtrl.text = item?.model ?? '';
      _descCtrl.text = item?.specification ?? '';
      _pickedCatalogItem = item;
      _locationId = _autoLocationForItem(item) ?? _locationId;
      _syncPathFromLeaf();
    });
  }

  List<Location> _childrenOf(String? id) =>
      _locations.where((l) => l.parentId == id).toList();

  /// Rebuild the picker path (root -> deepest) by walking up from the leaf.
  void _syncPathFromLeaf() {
    final byId = {for (final l in _locations) l.id: l};
    final chain = <String>[];
    final seen = <String>{};
    Location? cur = _locationId == null ? null : byId[_locationId];
    while (cur != null && !seen.contains(cur.id)) {
      seen.add(cur.id);
      chain.insert(0, cur.id);
      cur = cur.parentId != null ? byId[cur.parentId] : null;
    }
    _locPath = chain;
  }

  /// Cascading storage-location picker (mirrors Add Item): one dropdown per
  /// level, revealing the next sub-location until a leaf is reached — at any
  /// nesting depth. `_locationId` holds the chosen leaf.
  Widget _buildLocationPicker({required bool locked}) {
    // Build the levels: level 0 = top-level; each deeper level lists the
    // children of the location chosen above it, until a leaf is reached.
    final levels = <List<Location>>[];
    var options = _childrenOf(null);
    for (var i = 0;; i++) {
      levels.add(options);
      if (i >= _locPath.length) break;
      final kids = _childrenOf(_locPath[i]);
      if (kids.isEmpty) break; // reached a leaf
      options = kids;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < levels.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: i < _locPath.length ? _locPath[i] : null,
            decoration: InputDecoration(
              labelText: i == 0 ? 'Storage location' : 'Sub-location',
              suffixIcon:
                  locked && i == 0 ? const Icon(Icons.lock_outline, size: 18) : null,
            ),
            items: levels[i]
                .map((l) => DropdownMenuItem(
                    value: l.id,
                    child: Text(l.name,
                        maxLines: 1, overflow: TextOverflow.ellipsis)))
                .toList(),
            onChanged: locked
                ? null
                : (v) => setState(() {
                      _locPath = [..._locPath.sublist(0, i), if (v != null) v];
                      final last = _locPath.isEmpty ? null : _locPath.last;
                      // Items live in a leaf — only a fully-drilled path is valid.
                      _locationId =
                          last != null && _childrenOf(last).isEmpty ? last : null;
                    }),
          ),
        ],
      ],
    );
  }

  bool get _itemExistsInCatalog {
    final name = _nameCtrl.text.trim().toLowerCase();
    return name.isNotEmpty &&
        _catalog.any((c) => c.name.toLowerCase() == name);
  }

  Future<void> _quickRegister() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) return;
    setState(() => _registering = true);
    try {
      final newItem = await _inventory.registerCatalogItem(
        // The type defaults to the product name when it is left blank, so a
        // quick registration never blocks on a field the buyer did not fill.
        type: _typeCtrl.text.trim().isEmpty ? name : _typeCtrl.text.trim(),
        name: name,
        model: _modelCtrl.text.trim().isEmpty ? 'Unspecified' : _modelCtrl.text.trim(),
        specification: _descCtrl.text.trim(),
        category: _categoryCtrl.text.trim(),
        finishable: _finishable,
        unitsPerContainer: _countMode == 'package' ? 1 : int.tryParse(_unitsPerContainerCtrl.text.trim()),
        packageLabel: _countMode == 'package' ? _packageLabelCtrl.text.trim() : null,
      );
      if (!mounted) return;
      setState(() {
        _catalog = [..._catalog, newItem];
        _registering = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('"${newItem.name}" registered in catalog.')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _registering = false;
      });
    }
  }

  void _saveDraftAndPop() {
    Navigator.of(context).pop(PaymentDraft(
      paymentMethod: _paymentMethod,
      phone: _phoneCtrl.text.trim(),
      recipientName: _recipientNameCtrl.text.trim(),
      bankAccountNumber:
          _bankAccountNoCtrl.text.trim().isEmpty ? null : _bankAccountNoCtrl.text.trim(),
      bankAccountName:
          _bankAccountNameCtrl.text.trim().isEmpty ? null : _bankAccountNameCtrl.text.trim(),
      tinNumber: _tinCtrl.text.trim().isEmpty ? null : _tinCtrl.text.trim(),
      locationId: _locationId,
      products: List.from(_cart),
    ));
  }

  /// Everything this form holds, for [DraftStore].
  RequestSnapshot _snapshot({bool cameraPending = false}) => RequestSnapshot(
        paymentMethod: _paymentMethod,
        bkPayToBankAccount: _bkPayToBankAccount,
        phone: _phoneCtrl.text,
        recipientName: _recipientNameCtrl.text,
        bankAccountNumber: _bankAccountNoCtrl.text,
        bankAccountName: _bankAccountNameCtrl.text,
        tinNumber: _tinCtrl.text,
        name: _nameCtrl.text,
        type: _typeCtrl.text,
        model: _modelCtrl.text,
        specification: _descCtrl.text,
        quantity: _qtyCtrl.text,
        price: _priceCtrl.text,
        category: _categoryCtrl.text,
        finishable: _finishable,
        countMode: _countMode,
        unitsPerContainer: _unitsPerContainerCtrl.text,
        packageLabel: _packageLabelCtrl.text,
        locationId: _locationId,
        isCustomProduct: _isCustomProduct,
        cart: List.of(_cart),
        itemPhotoBase64: _itemPhotoBase64,
        cameraPending: cameraPending,
        savedAt: DateTime.now(),
      );

  void _applySnapshot(RequestSnapshot r) {
    _paymentMethod = r.paymentMethod;
    _bkPayToBankAccount = r.bkPayToBankAccount;
    _phoneCtrl.text = r.phone;
    _recipientNameCtrl.text = r.recipientName;
    _bankAccountNoCtrl.text = r.bankAccountNumber;
    _bankAccountNameCtrl.text = r.bankAccountName;
    _tinCtrl.text = r.tinNumber;
    _nameCtrl.text = r.name;
    _typeCtrl.text = r.type;
    _modelCtrl.text = r.model;
    _descCtrl.text = r.specification;
    _qtyCtrl.text = r.quantity;
    _priceCtrl.text = r.price;
    _categoryCtrl.text = r.category;
    _finishable = r.finishable;
    _countMode = r.countMode;
    _unitsPerContainerCtrl.text = r.unitsPerContainer;
    _packageLabelCtrl.text = r.packageLabel;
    _locationId = r.locationId;
    _isCustomProduct = r.isCustomProduct;
    _cart
      ..clear()
      ..addAll(r.cart);
    _itemPhotoBase64 = r.itemPhotoBase64;
  }

  Future<void> _captureItemPhoto([ImageSource source = ImageSource.camera]) async {
    try {
      // The camera can get this app killed on a low-memory phone. Save the form
      // first so it (and the photo, via retrieveLostData) can be restored.
      await DraftStore.save(_snapshot(cameraPending: true));
      final xfile = await _picker.pickImage(
        source: source,
        imageQuality: 70,
        maxWidth: 1024,
      );
      // Back alive: the safety net is no longer needed.
      await DraftStore.clear();
      if (xfile == null) return;
      final bytes = await xfile.readAsBytes();
      // Shrink to a JPEG data URL the API accepts as image_base64.
      final b64 = base64Encode(bytes);
      if (!mounted) return;
      setState(() => _itemPhotoBase64 = 'data:image/jpeg;base64,$b64');
    } catch (e) {
      if (!mounted) return;
      setState(() => _error =
          '${source == ImageSource.camera ? 'Camera' : 'Gallery'} failed: $e');
    }
  }

  void _addToCart() {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Product name is required.');
      return;
    }
    // A product that is not already in the catalog becomes a catalog item when
    // the purchase is approved, so it needs the same identity Add Item demands:
    // type + name + model. A catalog pick fills these in. Specification stays
    // optional here, as it is there.
    if (_pickedCatalogItem == null) {
      if (_typeCtrl.text.trim().isEmpty) {
        setState(() => _error = 'Item type is required for a product that is not in the catalog.');
        return;
      }
      if (_modelCtrl.text.trim().isEmpty) {
        setState(() => _error = 'Model is required for a product that is not in the catalog.');
        return;
      }
    }
    if (_itemPhotoBase64 == null) {
      setState(() => _error = 'Capture a photo of the item you are buying.');
      return;
    }
    final qty = int.tryParse(_qtyCtrl.text.trim()) ?? 0;
    if (qty <= 0) {
      setState(() => _error = 'Quantity must be at least 1.');
      return;
    }
    final price = double.tryParse(_priceCtrl.text.trim()) ?? 0;
    if (price <= 0) {
      setState(() => _error = 'Price must be greater than 0.');
      return;
    }
    setState(() {
      _cart.add(PaymentProduct(
        name: name,
        type: _typeCtrl.text.trim().isEmpty ? null : _typeCtrl.text.trim(),
        model: _modelCtrl.text.trim().isEmpty ? null : _modelCtrl.text.trim(),
        specification:
            _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
        quantity: qty,
        price: price,
        imageBase64: _itemPhotoBase64,
      ));
      _nameCtrl.clear();
      _typeCtrl.clear();
      _modelCtrl.clear();
      _descCtrl.clear();
      _qtyCtrl.text = '1';
      _priceCtrl.clear();
      _itemPhotoBase64 = null;
      _categoryCtrl.clear();
      _finishable = false;
      _countMode = 'units';
      _unitsPerContainerCtrl.text = '1';
      _packageLabelCtrl.text = 'package';
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;
    final locked = _cart.isNotEmpty;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _saveDraftAndPop();
      },
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.9,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: const EdgeInsets.symmetric(vertical: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .onSurfaceVariant
                    .withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.fromLTRB(16, 4, 16, 16 + bottomPad),
                children: [
                  Text('New Expense Request',
                      style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 16),

                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(_error!,
                          style: const TextStyle(color: Color(0xFFEF4444))),
                    ),

                  // Payment method
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'momo',
                        label: Text('MoMo'),
                        icon: Icon(Icons.phone_android, size: 16),
                      ),
                      ButtonSegment(
                        value: 'bk',
                        label: Text('Bank of Kigali'),
                        icon: Icon(Icons.account_balance, size: 16),
                      ),
                    ],
                    selected: {_paymentMethod},
                    onSelectionChanged: locked
                        ? null
                        : (s) => setState(() => _paymentMethod = s.first),
                  ),
                  const SizedBox(height: 12),

                  // Recipient
                  if (_paymentMethod == 'momo' || !_bkPayToBankAccount) ...[
                    TextField(
                      controller: _phoneCtrl,
                      enabled: !locked,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: _paymentMethod == 'momo'
                            ? 'Recipient phone / MoMo code'
                            : 'Recipient phone (employee)',
                        hintText: '+250 788 123 456',
                        suffixIcon: locked
                            ? const Tooltip(
                                message: 'Locked after first item is added',
                                child: Icon(Icons.lock_outline, size: 18))
                            : null,
                      ),
                    ),
                    if (_paymentMethod == 'bk') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _recipientNameCtrl,
                        enabled: !locked,
                        textCapitalization: TextCapitalization.words,
                        maxLength: 100,
                        decoration: const InputDecoration(
                          labelText: 'Recipient name',
                          hintText: 'Name on the mobile-money account',
                          counterText: '',
                        ),
                      ),
                    ],
                  ] else ...[
                    TextField(
                      controller: _bankAccountNoCtrl,
                      enabled: !locked,
                      decoration: const InputDecoration(
                          labelText: 'Bank account number'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _bankAccountNameCtrl,
                      enabled: !locked,
                      decoration: const InputDecoration(
                          labelText: 'Account holder name'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _tinCtrl,
                      enabled: !locked,
                      decoration: const InputDecoration(labelText: 'TIN number'),
                    ),
                  ],
                  // BK covers both a common case (pay the employee's phone)
                  // and a rarer one (pay a vendor's own bank account) — this
                  // toggle switches which fields are shown, phone by default.
                  if (_paymentMethod == 'bk')
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: locked
                            ? null
                            : () => setState(() {
                                  _bkPayToBankAccount = !_bkPayToBankAccount;
                                  if (_bkPayToBankAccount) {
                                    _phoneCtrl.clear();
                                    _recipientNameCtrl.clear();
                                  } else {
                                    _bankAccountNoCtrl.clear();
                                    _bankAccountNameCtrl.clear();
                                    _tinCtrl.clear();
                                  }
                                }),
                        icon: Icon(
                          _bkPayToBankAccount
                              ? Icons.phone_android
                              : Icons.account_balance,
                          size: 16,
                        ),
                        label: Text(_bkPayToBankAccount
                            ? "Pay an employee's phone instead?"
                            : "Paying a vendor's bank account instead?"),
                      ),
                    ),
                  const SizedBox(height: 12),

                  // Product comes right after the recipient so picking a catalog
                  // item can auto-select its storage location below before the
                  // user ever touches the location picker.
                  // Add product
                  Text('Add product',
                      style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 12),

                  // Catalog selector vs free-form (web parity)
                  Row(
                    key: const ValueKey('product-name-row'),
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: _loadingCatalog
                            ? const LinearProgressIndicator()
                            : !_isCustomProduct
                                ? Autocomplete<Item>(
                                    key: const ValueKey('catalog-autocomplete'),
                                    initialValue:
                                        TextEditingValue(text: _nameCtrl.text),
                                    // Same live-filter pattern already used for
                                    // the category field in add_item_sheet.dart —
                                    // filters by name OR SKU, so items sharing a
                                    // name are still distinguishable and findable.
                                    optionsBuilder: (value) {
                                      final q = value.text.trim().toLowerCase();
                                      if (q.isEmpty) return _catalog;
                                      return _catalog.where((item) =>
                                          item.name.toLowerCase().contains(q) ||
                                          item.type.toLowerCase().contains(q) ||
                                          item.model.toLowerCase().contains(q) ||
                                          item.sku.toLowerCase().contains(q));
                                    },
                                    displayStringForOption: (item) => item.name,
                                    onSelected: _onCatalogPicked,
                                    optionsViewBuilder: (context, onSelected, options) {
                                      final list = options.toList();
                                      return Align(
                                        alignment: Alignment.topLeft,
                                        child: Material(
                                          elevation: 4,
                                          borderRadius: BorderRadius.circular(8),
                                          child: ConstrainedBox(
                                            constraints: const BoxConstraints(maxHeight: 240),
                                            child: ListView.builder(
                                              padding: EdgeInsets.zero,
                                              shrinkWrap: true,
                                              itemCount: list.length,
                                              itemBuilder: (context, index) {
                                                final item = list[index];
                                                return ListTile(
                                                  dense: true,
                                                  title: Text(item.type),
                                                  subtitle: Text(item.itemLabel),
                                                  trailing: item.sku.isNotEmpty
                                                      ? Text(item.sku,
                                                          style: const TextStyle(fontSize: 11))
                                                      : null,
                                                  onTap: () => onSelected(item),
                                                );
                                              },
                                            ),
                                          ),
                                        ),
                                      );
                                    },
                                    fieldViewBuilder: (context, textCtl, focus, onSubmit) => TextField(
                                      controller: textCtl,
                                      focusNode: focus,
                                      decoration: const InputDecoration(
                                        labelText: 'Product name',
                                        hintText: 'Search a registered product…',
                                      ),
                                      // The autocomplete owns its own controller,
                                      // so mirror what is typed into _nameCtrl —
                                      // otherwise typing a full catalog name
                                      // without tapping a suggestion left the name
                                      // empty ("Product name is required").
                                      onChanged: (v) => setState(() {
                                        _nameCtrl.text = v;
                                        if (_pickedCatalogItem != null &&
                                            _pickedCatalogItem!.name != v) {
                                          _pickedCatalogItem = null;
                                        }
                                      }),
                                    ),
                                  )
                                : TextField(
                                    controller: _nameCtrl,
                                    decoration: const InputDecoration(
                                      labelText: 'Product name',
                                      hintText: 'e.g. Verlet Core Board',
                                    ),
                                  ),
                      ),
                      const SizedBox(width: 8),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 72),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Switch(
                              value: _isCustomProduct,
                              onChanged: (v) => setState(() {
                                _isCustomProduct = v;
                                _nameCtrl.clear();
                                _typeCtrl.clear();
                                _modelCtrl.clear();
                                _descCtrl.clear();
                                _categoryCtrl.clear();
                                _finishable = false;
                                _countMode = 'units';
                                _pickedCatalogItem = null;
                                _locationId = null;
                                _locPath = [];
                              }),
                            ),
                            const Text('Not in\ncatalog',
                                style: TextStyle(fontSize: 10),
                                textAlign: TextAlign.center),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Catalog verification / quick register (web parity)
                  if (_nameCtrl.text.trim().isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        border: Border.all(
                            color: Theme.of(context)
                                .colorScheme
                                .outlineVariant),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                            child: _itemExistsInCatalog
                                ? const Text(
                                    '✓ Item verified in catalog stock.',
                                    style: TextStyle(
                                        fontSize: 11,
                                        color: Color(0xFF22C55E)),
                                  )
                                : const Text(
                                    '⚠ Not found in catalog registry.',
                                    style: TextStyle(
                                        fontSize: 11,
                                        color: Color(0xFFF59E0B)),
                                  ),
                          ),
                          if (!_itemExistsInCatalog && api.canManageInventory)
                            _registering
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : Flexible(
                                    fit: FlexFit.loose,
                                    child: TextButton(
                                      onPressed: _quickRegister,
                                      child: const Text('Quick Register',
                                          style: TextStyle(fontSize: 11)),
                                    ),
                                  )
                          else if (!_itemExistsInCatalog)
                            const Flexible(
                              fit: FlexFit.loose,
                              child: Text(
                                'Will request registration on submit',
                                style:
                                    TextStyle(fontSize: 10, fontStyle: FontStyle.italic),
                              ),
                            ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),

                  // Location
                  if (_loadingLocs)
                    const LinearProgressIndicator()
                  else
                    _buildLocationPicker(locked: locked),
                  if (!_isCustomProduct && _pickedCatalogItem != null)
                    _buildAutoSelectHint(),

                  const SizedBox(height: 12),

                  TextField(
                    controller: _typeCtrl,
                    decoration: const InputDecoration(
                        labelText: 'Item type',
                        hintText: 'e.g. Cable',
                        helperText: 'The SKU is built from this when the item is created.'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _modelCtrl,
                    decoration: const InputDecoration(
                        labelText: 'Model', hintText: 'e.g. CAT6-3M'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _descCtrl,
                    decoration: const InputDecoration(
                        labelText: 'Specification (optional)'),
                  ),
                  const SizedBox(height: 12),

                  // Catalog metadata for a genuinely new item — only relevant
                  // when Quick Register will create one; an existing catalog
                  // item already has this on file.
                  if (_isCustomProduct && !_itemExistsInCatalog) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('New catalog item details',
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 0.5,
                                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
                          const SizedBox(height: 8),
                          Autocomplete<String>(
                            optionsBuilder: (value) {
                              final q = value.text.trim().toLowerCase();
                              if (q.isEmpty) return _categories;
                              return _categories.where((c) => c.toLowerCase().contains(q));
                            },
                            onSelected: (v) => _categoryCtrl.text = v,
                            fieldViewBuilder: (ctx, textCtl, focus, onSubmit) => TextField(
                              controller: textCtl,
                              focusNode: focus,
                              textCapitalization: TextCapitalization.words,
                              onChanged: (v) => _categoryCtrl.text = v,
                              decoration: const InputDecoration(
                                labelText: 'Category (optional)',
                                hintText: 'e.g. Computer Laptop, Cables',
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            dense: true,
                            title: const Text('Finishable', style: TextStyle(fontSize: 13)),
                            subtitle: const Text('Users can permanently use this item up.',
                                style: TextStyle(fontSize: 11)),
                            value: _finishable,
                            onChanged: (v) => setState(() => _finishable = v),
                          ),
                          DropdownButtonFormField<String>(
                            initialValue: _countMode,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Counted as'),
                            items: const [
                              DropdownMenuItem(value: 'units', child: Text('Individual units')),
                              DropdownMenuItem(
                                  value: 'package', child: Text("Packages (don't count contents)")),
                            ],
                            onChanged: (v) => setState(() => _countMode = v ?? 'units'),
                          ),
                          if (_countMode == 'package') ...[
                            const SizedBox(height: 12),
                            TextField(
                              controller: _packageLabelCtrl,
                              decoration: const InputDecoration(
                                  labelText: 'Package label',
                                  hintText: 'e.g. package, crate, reel'),
                            ),
                          ] else ...[
                            const SizedBox(height: 12),
                            TextField(
                              controller: _unitsPerContainerCtrl,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                  labelText: 'Units per container',
                                  hintText: '1 = loose units; e.g. 12 per box'),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],

                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _qtyCtrl,
                          keyboardType: TextInputType.number,
                          decoration:
                              const InputDecoration(labelText: 'Qty'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: _priceCtrl,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          decoration: const InputDecoration(
                              labelText: 'Unit price (RWF)'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Storage location is chosen once for the whole request in the
                  // cascading picker above (auto-selected when a catalog item is
                  // picked; locked after the first item is added).

                  // Item photo capture (required before add to cart) —
                  // camera or gallery, matching Add Item's photo options.
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _captureItemPhoto(ImageSource.camera),
                          icon: const Icon(Icons.camera_alt_outlined, size: 18),
                          label: Text(_itemPhotoBase64 == null
                              ? 'Capture photo'
                              : 'Retake photo'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        tooltip: 'Choose from gallery',
                        onPressed: () => _captureItemPhoto(ImageSource.gallery),
                        icon: const Icon(Icons.photo_library_outlined),
                      ),
                      if (_itemPhotoBase64 != null) ...[
                        const SizedBox(width: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            base64Decode(
                                _itemPhotoBase64!.split(',').last),
                            width: 48,
                            height: 48,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _addToCart,
                    icon: const Icon(Icons.add_shopping_cart, size: 18),
                    label: const Text('Add to cart'),
                  ),
                  if (_cart.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${_cart.length} item${_cart.length == 1 ? '' : 's'}'
                              ' in cart · ${formatRwf(_cart.fold<double>(0, (s, p) => s + p.price * p.quantity))}',
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.icon(
                            onPressed: _saveDraftAndPop,
                            icon: const Icon(Icons.shopping_cart_checkout,
                                size: 18),
                            label: const Text('View cart'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
