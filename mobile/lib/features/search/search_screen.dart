import 'dart:async';

import 'package:flutter/material.dart';

import '../../models.dart';
import '../../repository.dart';
import '../../search_logic.dart';
import '../items/item_detail_screen.dart';
import '../locations/location_detail_screen.dart';

/// Search as you type: the best matching items (with how many there are and which
/// box they are in) and locations. Answers "do we have it, and where?" without
/// scrolling a list.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _repo = const InventoryRepository();
  final _controller = TextEditingController();
  Timer? _debounce;

  List<Location> _locations = [];
  Map<String, Location> _byId = {};

  /// What the results below are FOR. They are replaced only when a newer answer
  /// arrives, so the list does not flash empty between keystrokes.
  String _shownFor = '';
  List<Item> _items = [];
  Map<String, ItemWhere> _where = {};
  List<Location> _matchedLocations = [];
  bool _failed = false;
  int _seq = 0; // the latest request wins; an older answer arriving late is dropped

  @override
  void initState() {
    super.initState();
    // Locations are a short list: load once, rank on the phone.
    _repo.fetchLocations().then((l) {
      if (!mounted) return;
      setState(() {
        _locations = l;
        _byId = {for (final x in l) x.id: x};
      });
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    final q = value.trim();
    if (q.isEmpty) {
      _seq++;
      setState(() {
        _shownFor = '';
        _items = [];
        _where = {};
        _matchedLocations = [];
        _failed = false;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () => _run(q));
  }

  Future<void> _run(String q) async {
    final seq = ++_seq;
    try {
      final found = rankItems(await _repo.searchItems(q), q);
      // Stock is a nice-to-have: if that lookup fails the matches still show.
      final where = await _repo
          .fetchWhere([for (final i in found) i.id])
          .catchError((_) => <String, ItemWhere>{});
      if (!mounted || seq != _seq) return;
      setState(() {
        _shownFor = q;
        _items = found;
        _where = where;
        _matchedLocations = rankLocations(_locations, q);
        _failed = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final typed = _controller.text.trim();
    final empty = _shownFor.isNotEmpty && _items.isEmpty && _matchedLocations.isEmpty;

    Widget message(String text) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(text, textAlign: TextAlign.center, style: TextStyle(color: cs.onSurfaceVariant)),
          ),
        );

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onChanged: (v) {
            setState(() {}); // the clear button follows the text
            _onChanged(v);
          },
          decoration: InputDecoration(
            hintText: 'Search items, locations…',
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            filled: false,
            suffixIcon: typed.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear',
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _controller.clear();
                      _onChanged('');
                      setState(() {});
                    },
                  ),
          ),
        ),
      ),
      body: _failed
          ? message("Couldn't search just now. Check your connection and try again.")
          : typed.isEmpty
              ? message('Type a name, type, model or SKU to see what is in stock and which box it is in.')
              : empty
                  ? message('No item or location matches “$_shownFor”.')
                  : ListView(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      children: [
                        if (_items.isNotEmpty) const _Heading('Items'),
                        for (final item in _items) _ItemTile(item: item, where: _where[item.id]),
                        if (_matchedLocations.isNotEmpty) const _Heading('Locations'),
                        for (final loc in _matchedLocations)
                          ListTile(
                            leading: Icon(loc.isBox ? Icons.inventory_2_outlined : Icons.warehouse_outlined),
                            title: Text(locationPathOf(loc, _byId), maxLines: 2, overflow: TextOverflow.ellipsis),
                            subtitle: loc.boxBadge == null ? null : Text(loc.boxBadge!),
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => LocationDetailScreen(locationId: loc.id)),
                            ),
                          ),
                      ],
                    ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.6,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      );
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item, required this.where});
  final Item item;
  final ItemWhere? where;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final stock = stockSummary(where);
    final lines = [
      if (stock.where != null) stock.where!,
      if (item.sku.isNotEmpty) item.sku,
    ];
    return ListTile(
      leading: const Icon(Icons.widgets_outlined),
      title: Text(searchItemLabel(item), maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: lines.isEmpty ? null : Text(lines.join('\n'), maxLines: 3, overflow: TextOverflow.ellipsis),
      isThreeLine: lines.length > 1,
      trailing: stock.count.isEmpty
          ? null
          : Text(
              stock.count,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: stock.inStock ? const Color(0xFF15803D) : cs.onSurfaceVariant,
              ),
            ),
      // Open the item AT the place with the most — one tap from taking it.
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ItemDetailScreen(
            itemId: item.id,
            locationId: where != null && where!.places.isNotEmpty ? where!.places.first.locationId : null,
          ),
        ),
      ),
    );
  }
}
