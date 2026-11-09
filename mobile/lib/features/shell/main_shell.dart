import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import '../../payment_repository.dart';
import '../../pending_photo_store.dart';
import '../../repository.dart';
import '../dashboard/dashboard_screen.dart';
import '../equipment/equipment_screen.dart';
import '../items/items_admin_screen.dart';
import '../locations/locations_screen.dart';
import '../payments/draft_store.dart';
import '../payments/payments_screen.dart';
import '../reports/reports_screen.dart';
import '../settings/settings_screen.dart';
import '../users/users_screen.dart';

class _Tab {
  _Tab(this.label, this.icon, this.selectedIcon, this.screen);
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget screen;
}

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _active = 0;
  int _secSlot = 0;
  // Tabs already opened. Others are not built, so signing in no longer fires
  // every screen's requests (and timers) at once; once opened a tab keeps its
  // state, as the IndexedStack always did.
  final Set<int> _visited = {0};

  @override
  void initState() {
    super.initState();
    // If the previous run was killed while the payment form's camera was open,
    // bring the user back to Payments with their form restored.
    DraftStore.resume.addListener(_goToPaymentsForResume);
    DraftStore.restoreAfterProcessDeath();
    // Same for a photo that uploads straight away (an item's picture, a receipt).
    PendingPhotoStore.message.addListener(_showRecoveredPhoto);
    PendingPhotoStore.restoreAfterProcessDeath(
      uploadItemPhoto: const InventoryRepository().uploadItemPhoto,
      uploadReceipt: (id, bytes) => const PaymentRepository().uploadReceipt(id, bytes),
    );
  }

  void _showRecoveredPhoto() {
    final text = PendingPhotoStore.message.value;
    if (text == null || !mounted) return;
    PendingPhotoStore.message.value = null; // shown once
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 8)));
  }

  @override
  void dispose() {
    DraftStore.resume.removeListener(_goToPaymentsForResume);
    PendingPhotoStore.message.removeListener(_showRecoveredPhoto);
    super.dispose();
  }

  void _goToPaymentsForResume() {
    if (DraftStore.resume.value == null || !mounted) return;
    final api = ApiClient.instance;
    // Payments is only a tab for people who can use it; nothing to resume into otherwise.
    if (!(api.canApprovePayments || api.hasPaymentPermission)) return;
    // Primary order is Home, [Items (warehouse staff)], Payments.
    setState(() => _active = api.canManageInventory ? 2 : 1);
  }

  @override
  Widget build(BuildContext context) {
    // Three separate questions, not one. Running the warehouse, running the
    // people, and touching money are different rights — see config/roles.dart.
    final api = ApiClient.instance;
    final isAdmin = api.isAdmin;
    final canStock = api.canManageInventory;
    final canPay = api.canApprovePayments || api.hasPaymentPermission;

    final primary = <_Tab>[
      _Tab('Home', Icons.home_outlined, Icons.home, const DashboardScreen()),
      if (canStock)
        _Tab('Items', Icons.inventory_2_outlined, Icons.inventory_2, const ItemsAdminScreen()),
      if (canPay)
        _Tab('Payments', Icons.receipt_long_outlined, Icons.receipt_long, const PaymentsScreen()),
    ];

    final secondary = <_Tab>[
      _Tab('Settings', Icons.settings_outlined, Icons.settings, const SettingsScreen()),
      _Tab('Locations', Icons.warehouse_outlined, Icons.warehouse, const LocationsScreen()),
      // Users is running the place, not the warehouse — admin only.
      if (isAdmin)
        _Tab('Users', Icons.group_outlined, Icons.group, const UsersScreen()),
      // Who is holding what — a warehouse view, so stock managers get it too.
      if (canStock)
        _Tab('Borrowed', Icons.assignment_ind_outlined, Icons.assignment_ind, const EquipmentScreen()),
      if (canStock)
        _Tab('Reports', Icons.assessment_outlined, Icons.assessment, const ReportsScreen()),
    ];

    final all = [...primary, ...secondary];
    final screens = all.map((t) => t.screen).toList();
    final useCycling = all.length > 5;

    final activeIdx = _active.clamp(0, screens.length - 1);
    _visited.add(activeIdx);
    final secSlot = _secSlot.clamp(0, secondary.length - 1);
    final isOnSecondary = activeIdx >= primary.length;

    return Scaffold(
      body: IndexedStack(
        index: activeIdx,
        children: [
          for (var i = 0; i < screens.length; i++)
            _visited.contains(i) || i == activeIdx
                ? screens[i]
                : const SizedBox.shrink(),
        ],
      ),
      bottomNavigationBar: useCycling
          ? _CyclingNav(
              primary: primary,
              secondaryTab: secondary[secSlot],
              activePrimaryIdx: isOnSecondary ? -1 : activeIdx,
              secondaryActive: isOnSecondary,
              onPrimary: (i) => setState(() => _active = i),
              onSecondary: () => setState(() => _active = primary.length + secSlot),
              onCycle: () => setState(() {
                _secSlot = (secSlot + 1) % secondary.length;
                if (isOnSecondary) _active = primary.length + _secSlot;
              }),
            )
          : _FlatNav(
              tabs: all,
              activeIdx: activeIdx,
              onTab: (i) => setState(() => _active = i),
            ),
    );
  }
}

class _FlatNav extends StatelessWidget {
  const _FlatNav({
    required this.tabs,
    required this.activeIdx,
    required this.onTab,
  });

  final List<_Tab> tabs;
  final int activeIdx;
  final void Function(int) onTab;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainer,
        border: Border(top: BorderSide(color: cs.outlineVariant, width: 0.5)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 72,
          child: Row(
            children: [
              for (int i = 0; i < tabs.length; i++)
                Expanded(
                  child: _NavBtn(
                    label: tabs[i].label,
                    icon: tabs[i].icon,
                    selectedIcon: tabs[i].selectedIcon,
                    selected: activeIdx == i,
                    onTap: () => onTab(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CyclingNav extends StatelessWidget {
  const _CyclingNav({
    required this.primary,
    required this.secondaryTab,
    required this.activePrimaryIdx,
    required this.secondaryActive,
    required this.onPrimary,
    required this.onSecondary,
    required this.onCycle,
  });

  final List<_Tab> primary;
  final _Tab secondaryTab;
  final int activePrimaryIdx;
  final bool secondaryActive;
  final void Function(int) onPrimary;
  final VoidCallback onSecondary;
  final VoidCallback onCycle;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainer,
        border: Border(top: BorderSide(color: cs.outlineVariant, width: 0.5)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 72,
          child: Row(
            children: [
              for (int i = 0; i < primary.length; i++)
                Expanded(
                  child: _NavBtn(
                    label: primary[i].label,
                    icon: primary[i].icon,
                    selectedIcon: primary[i].selectedIcon,
                    selected: activePrimaryIdx == i,
                    onTap: () => onPrimary(i),
                  ),
                ),
              Expanded(
                child: _NavBtn(
                  label: secondaryTab.label,
                  icon: secondaryTab.icon,
                  selectedIcon: secondaryTab.selectedIcon,
                  selected: secondaryActive,
                  onTap: onSecondary,
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 10),
                child: InkWell(
                  onTap: onCycle,
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    child: Icon(Icons.swap_horiz,
                        color: cs.onSurface, size: 22,
                        weight: 700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavBtn extends StatelessWidget {
  const _NavBtn({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final color = selected ? cs.onSecondaryContainer : cs.onSurfaceVariant;

    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: selected ? cs.secondaryContainer : Colors.transparent,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              selected ? selectedIcon : icon,
              color: color,
              size: 24,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: color,
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
