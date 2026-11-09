import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_mobile/box_qr.dart';
import 'package:inventory_mobile/models.dart';
import 'package:inventory_mobile/search_logic.dart';

Item item(String type, String name, {String model = 'Unspecified', String sku = 'vrlt-x-001', String? spec}) =>
    Item(id: '$type-$name', type: type, name: name, model: model, sku: sku, specification: spec);

void main() {
  group('box QR', () {
    test('round-trips a code, forgiving about case and spaces', () {
      expect(parseBoxQr(boxQrData('ABCDEFGH23')), 'ABCDEFGH23');
      expect(parseBoxQr('  inventory:box:abcdefgh23 '), 'ABCDEFGH23');
    });
    test('rejects anything that is not a box code', () {
      expect(parseBoxQr('inventory:item:6f1c2d3e-0000-4000-8000-000000000000'), isNull);
      expect(parseBoxQr('inventory:box:'), isNull);
      expect(parseBoxQr('inventory:box:SHORT'), isNull);
      expect(parseBoxQr('inventory:box:ABCDEFGHIO'), isNull); // I and O are never issued
      expect(parseBoxQr('ABCDEFGH23'), isNull); // must carry the prefix
    });
  });

  group('searchItemLabel', () {
    test('is type · name · model, without stuttering or the placeholder model', () {
      expect(searchItemLabel(item('Cable', 'USB-A to C', model: '1m')), 'Cable · USB-A to C · 1m');
      expect(searchItemLabel(item('Cable', 'USB-A to C')), 'Cable · USB-A to C');
      expect(searchItemLabel(item('Laptop', 'Laptop', model: 'X1')), 'Laptop · X1');
    });
  });

  group('rankItems', () {
    final items = [
      item('Cable', 'USB-A to C', model: '1m', sku: 'vrlt-cbl-001'),
      item('Cable', 'HDMI', model: '2m', sku: 'vrlt-cbl-002'),
      item('Single-board computer', 'Pi', model: 'Pi 5', sku: 'vrlt-sngl-001'),
      item('Tool', 'Hex key set', spec: 'fits Bambu printers'),
    ];
    test('finds by type, ranked by name', () {
      expect(rankItems(items, 'cable').map((i) => i.name), ['HDMI', 'USB-A to C']);
    });
    test('finds by model, by SKU and by spec (spec last)', () {
      expect(rankItems(items, 'pi 5').first.name, 'Pi');
      expect(rankItems(items, 'cbl-002').first.name, 'HDMI');
      expect(rankItems(items, 'bambu').single.name, 'Hex key set');
    });
    test('respects the limit and returns nothing for no match', () {
      expect(rankItems(items, 'cable', limit: 1), hasLength(1));
      expect(rankItems(items, 'zzz'), isEmpty);
    });
  });

  group('locations', () {
    final room = Location(id: 'w', name: 'Warehouse');
    final shelf = Location(id: 's', name: 'Shelf 3', parentId: 'w');
    final box = Location(id: 'b', name: 'Box 4', parentId: 's', kind: 'box', label: 'USB-A to C cables');
    final byId = {for (final l in [room, shelf, box]) l.id: l};

    test('the path tells two same-named places apart, and survives a loop', () {
      expect(locationPathOf(box, byId), 'Warehouse › Shelf 3 › Box 4');
      final a = Location(id: 'a', name: 'A', parentId: 'b2');
      final b = Location(id: 'b2', name: 'B', parentId: 'a');
      expect(locationPathOf(a, {'a': a, 'b2': b}), 'B › A');
    });
    test('a box is found by what it holds as well as its name', () {
      expect(rankLocations([room, shelf, box], 'usb').map((l) => l.id), ['b']);
      expect(rankLocations([room, shelf, box], 'shelf').map((l) => l.id), ['s']);
    });
  });

  group('stockSummary', () {
    const boxPlace = StockPlace(locationId: 'b', path: 'Shelf 2 › Box 4', kind: 'box', label: 'Pis', quantity: 5);
    const shelfPlace = StockPlace(locationId: 's', path: 'Shelf 2', kind: 'shelf', label: null, quantity: 2);

    test('says nothing when the stock lookup failed, and "none" when there is none', () {
      expect(stockSummary(null).count, '');
      final none = stockSummary(const ItemWhere(itemId: 'i', total: 0, places: []));
      expect((none.count, none.where, none.inStock), ('None in stock', null, false));
    });
    test('names how many and where, including the other places', () {
      final one = stockSummary(const ItemWhere(itemId: 'i', total: 5, places: [boxPlace]));
      expect((one.count, one.where, one.inStock), ('5 in stock', 'Box “Pis” · Shelf 2 › Box 4', true));
      final two = stockSummary(const ItemWhere(itemId: 'i', total: 7, places: [boxPlace, shelfPlace]));
      expect(two.where, 'Box “Pis” · Shelf 2 › Box 4 (+1 more place)');
    });
  });
}
