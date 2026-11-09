import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../payment_repository.dart';
import '../../widgets.dart';
import 'budget_card.dart';
import 'new_request_sheet.dart';
import 'notifications_sheet.dart';
import 'cart_page.dart';
import 'draft_store.dart';
import 'payments_report_screen.dart';
import 'reports_card.dart';
import 'transaction_detail_sheet.dart';
import 'transaction_row.dart';
import '../../widgets/search_button.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen>
    with WidgetsBindingObserver {
  final _repo = const PaymentRepository();

  PaymentDraft? _draft;
  List<PaymentTransaction> _transactions = [];
  PaymentBudget? _budget;
  PaymentBalance? _balance;
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;
  bool _inForeground = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // A request recovered after Android killed the app during the camera.
    DraftStore.resume.addListener(_resumeRecovered);
    WidgetsBinding.instance.addPostFrameCallback((_) => _resumeRecovered());
    _load();
    // 30s poll, as on web. Admins poll so the approval bell stays fresh; anyone
    // polls while one of their transfers is still `processing`, so it settles
    // on screen without a manual refresh. Skipped while the app is in the
    // background — the shell keeps every tab alive, so without this it would
    // keep hitting the API with the phone locked.
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted || _loading || !_inForeground) return;
      final hasProcessing =
          _transactions.any((t) => t.status == PaymentStatus.processing);
      if (api.isAdmin || hasProcessing) _load();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final resumed = state == AppLifecycleState.resumed;
    if (resumed && !_inForeground && mounted && !_loading) _load();
    _inForeground = resumed;
  }

  void _resumeRecovered() {
    final snap = DraftStore.resume.value;
    if (snap == null || !mounted) return;
    DraftStore.resume.value = null; // consume
    _openNewRequest(resume: snap);
  }

  @override
  void dispose() {
    DraftStore.resume.removeListener(_resumeRecovered);
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _repo.fetchTransactions(),
        _repo.fetchBudget(),
        _repo.fetchBalance(),
      ]);
      if (!mounted) return;
      setState(() {
        _transactions = results[0] as List<PaymentTransaction>;
        _budget = results[1] as PaymentBudget?;
        _balance = results[2] as PaymentBalance?;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  void _updateTxStatus(String id, PaymentStatus status) {
    final idx = _transactions.indexWhere((t) => t.id == id);
    if (idx == -1) return;
    final old = _transactions[idx];
    setState(() {
      _transactions = List.from(_transactions)..[idx] = PaymentTransaction(
        id: old.id,
        recipientPhone: old.recipientPhone,
        amount: old.amount,
        status: status,
        locationId: old.locationId,
        createdAt: old.createdAt,
        createdByName: old.createdByName,
        locationName: old.locationName,
        products: old.products,
        paymentMethod: old.paymentMethod,
        paymentMetadata: old.paymentMetadata,
      );
    });
  }

  Future<void> _openDetail(PaymentTransaction tx) async {
    final result = await showSlideSheet<TransactionResolveResult>(
      context,
      builder: (_) => TransactionDetailSheet(
        tx: tx,
        onStatusChanged: (status) {
          if (!mounted) return;
          _updateTxStatus(tx.id, status);
        },
      ),
    );
    if (!mounted) return;
    if (result == null) return;
    if (result.newStatus != null) _updateTxStatus(tx.id, result.newStatus!);
    if (result.reloadNeeded) _load();
  }

  Future<void> _exportCsv() async {
    try {
      final csv = await _repo.exportReportCsv();
      final bytes = utf8.encode(csv);
      await Share.shareXFiles(
        [XFile.fromData(bytes, mimeType: 'application/octet-stream', name: 'expense_report.csv')],
        subject: 'Expense Report',
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Export failed: $e')),
      );
    }
  }

  Future<void> _openNewRequest({RequestSnapshot? resume}) async {
    final result = await showSlideSheet<PaymentDraft>(
      context,
      builder: (_) => NewRequestSheet(draft: _draft, resume: resume),
    );
    if (result == null || !mounted) return;
    if (result.submitted) {
      setState(() => _draft = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Expense request submitted for approval.')),
      );
      _load();
    } else {
      setState(() => _draft = result.hasItems ? result : null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final hasDraft = _draft != null && _draft!.hasItems;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payments'),
        actions: [
          const SearchButton(),
          _NotificationBell(
            transactions: _transactions,
            currentUserName: api.currentFullName ?? '',
            onResolved: _updateTxStatus,
            balance: _balance,
            onOpenDetail: _openDetail,
          ),
          if (api.canApprovePayments)
            IconButton(
              tooltip: 'Payments report',
              icon: const Icon(Icons.bar_chart),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PaymentsReportScreen()),
              ),
            ),
          IconButton(
            tooltip: 'Export CSV',
            icon: const Icon(Icons.download_outlined),
            onPressed: _loading ? null : _exportCsv,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: null,
        onPressed: _openNewRequest,
        icon: const Icon(Icons.add),
        label: const Text('New Request'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _buildList(hasDraft, muted),
            ),
    );
  }

  Widget _buildList(bool hasDraft, Color muted) {
    final hasBudget = _budget != null;
    final headers = <Widget>[
      if (hasBudget)
        BudgetCard(
          budget: _budget!,
          balance: _balance,
          onUpdated: (b) => setState(() => _budget = b),
        ),
      ReportsCard(
        transactions: _transactions,
        currentUserName: api.currentFullName ?? '',
        isAdmin: api.isAdmin,
      ),
      if (hasDraft)
        _CartCard(
          draft: _draft!,
          onEdit: _openNewRequest,
          onClear: () => setState(() => _draft = null),
        ),
    ];
    // A failed load (including a failed background poll) must be visible, with
    // a way to retry — and an empty list must say so. These used to live in a
    // branch that could never run because the header cards are always present.
    if (_error != null) {
      headers.add(_LoadErrorCard(onRetry: _load));
    } else if (_transactions.isEmpty) {
      headers.add(_EmptyNote(muted: muted));
    }

    final headerCount = headers.length;
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(top: 8, bottom: 100),
      itemCount: headerCount + _transactions.length,
      separatorBuilder: (_, i) {
        if (i < headerCount - 1) return const SizedBox.shrink();
        if (i == headerCount - 1) return const SizedBox(height: 4);
        return const Divider(height: 1, indent: 16, endIndent: 16);
      },
      itemBuilder: (_, i) {
        if (i < headerCount) return headers[i];
        final tx = _transactions[i - headerCount];
        return TransactionRow(tx: tx, onTap: () => _openDetail(tx));
      },
    );
  }
}

class _LoadErrorCard extends StatelessWidget {
  const _LoadErrorCard({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      color: cs.errorContainer,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Row(
          children: [
            Icon(Icons.cloud_off_outlined, color: cs.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                "Couldn't refresh payments. Showing the last data we have.",
                style: TextStyle(color: cs.onErrorContainer),
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  const _EmptyNote({required this.muted});

  final Color muted;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Column(
        children: [
          Icon(Icons.receipt_long_outlined, size: 48, color: muted),
          const SizedBox(height: 12),
          Text(
            'No transactions yet.',
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: muted),
          ),
        ],
      ),
    );
  }
}

class _CartCard extends StatelessWidget {
  const _CartCard({
    required this.draft,
    required this.onEdit,
    required this.onClear,
  });

  final PaymentDraft draft;
  final VoidCallback onEdit;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final total =
        draft.products.fold<double>(0, (s, p) => s + p.price * p.quantity);
    final count = draft.products.length;

    return Card(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: InkWell(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => CartPage(
              draft: draft,
              onSubmitted: onClear,
            ),
          ),
        ),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
          child: Row(
            children: [
              Icon(Icons.shopping_cart_outlined, color: cs.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Draft request',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(
                      '$count item${count == 1 ? '' : 's'} · ${formatRwf(total)}',
                      style:
                          TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                    ),
                    if (draft.paymentMethod == 'bk')
                      Text(
                        'To: ${draft.bankAccountName ?? draft.bankAccountNumber ?? 'Bank of Kigali'}',
                        style: TextStyle(
                            fontSize: 12, color: cs.onSurfaceVariant),
                      )
                    else if (draft.phone.isNotEmpty)
                      Text(
                        'To: ${draft.phone}',
                        style: TextStyle(
                            fontSize: 12, color: cs.onSurfaceVariant),
                      ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                color: cs.onSurfaceVariant,
                tooltip: 'Discard draft',
                onPressed: onClear,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotificationBell extends StatelessWidget {
  const _NotificationBell({
    required this.transactions,
    required this.currentUserName,
    required this.onResolved,
    required this.balance,
    required this.onOpenDetail,
  });
  final List<PaymentTransaction> transactions;
  final String currentUserName;
  final void Function(String id, PaymentStatus) onResolved;
  final PaymentBalance? balance;
  final void Function(PaymentTransaction) onOpenDetail;

  @override
  Widget build(BuildContext context) {
    // Approval queue is admin/cashier-only — matches the web bell, which
    // never counts pending-approval for a plain member.
    final pendingApprovals = api.isAdmin
        ? transactions.where((t) => t.status == PaymentStatus.pending).length
        : 0;
    final pendingReceipts = transactions
        .where((t) =>
            t.status == PaymentStatus.completed &&
            t.receiptPhoto == null &&
            t.createdByName == currentUserName)
        .length;
    final count = pendingApprovals + pendingReceipts;
    final balanceText = balance == null
        ? null
        : 'RWF ${balance!.availableBalance.round()}';

    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          tooltip: 'Notifications',
          icon: const Icon(Icons.notifications_outlined),
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => NotificationsPage(
                transactions: transactions,
                currentUserName: currentUserName,
                balance: balanceText,
                onResolved: onResolved,
                onOpenDetail: onOpenDetail,
              ),
            ),
          ),
        ),
        if (count > 0)
          Positioned(
            top: 8,
            right: 8,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(
                color: Color(0xFFEF4444),
                shape: BoxShape.circle,
              ),
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              child: Text(
                '$count',
                style: const TextStyle(
                    fontSize: 10,
                    color: Colors.white,
                    fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            ),
          ),
      ],
    );
  }
}
