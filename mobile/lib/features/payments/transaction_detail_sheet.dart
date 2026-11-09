import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../config/theme.dart';
import 'package:image_picker/image_picker.dart';

import '../../config/api_client.dart';
import '../../models.dart';
import '../../payment_repository.dart';
import '../../pending_photo_store.dart';
import 'new_request_sheet.dart';
import 'payment_products_table.dart';

class TransactionResolveResult {
  const TransactionResolveResult({this.newStatus, this.reloadNeeded = false});
  final PaymentStatus? newStatus;
  final bool reloadNeeded;
}

class TransactionDetailSheet extends StatefulWidget {
  const TransactionDetailSheet({
    super.key,
    required this.tx,
    this.onStatusChanged,
  });
  final PaymentTransaction tx;
  final void Function(PaymentStatus)? onStatusChanged;

  @override
  State<TransactionDetailSheet> createState() => _TransactionDetailSheetState();
}

class _TransactionDetailSheetState extends State<TransactionDetailSheet> {
  final _repo = const PaymentRepository();
  late PaymentStatus _currentStatus;
  bool _resolving = false;
  bool _resolveAttempted = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _currentStatus = widget.tx.status;
  }

  void _pop(TransactionResolveResult? result) =>
      Navigator.of(context).pop(result);

  final _picker = ImagePicker();
  bool _uploadingReceipt = false;
  Uint8List? _receiptPreview;

  Future<void> _captureReceipt() async {
    setState(() => _uploadingReceipt = true);
    try {
      // If Android kills the app while the camera is open, the next start finishes this.
      await PendingPhotoStore.save(PendingPhotoKind.receipt, widget.tx.id);
      final xfile = await _picker.pickImage(
        source: ImageSource.camera,
        imageQuality: 70,
        maxWidth: 1024,
      );
      await PendingPhotoStore.clear();
      if (xfile == null) {
        if (mounted) setState(() => _uploadingReceipt = false);
        return;
      }
      final bytes = await xfile.readAsBytes();
      if (!mounted) return;
      setState(() {
        _receiptPreview = bytes;
        _uploadingReceipt = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Camera failed: $e';
        _uploadingReceipt = false;
      });
    }
  }

  Future<void> _submitReceipt() async {
    if (_receiptPreview == null) return;
    setState(() => _uploadingReceipt = true);
    try {
      await _repo.uploadReceipt(widget.tx.id, _receiptPreview!);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Receipt uploaded ✓')),
      );
      widget.onStatusChanged?.call(_currentStatus);
      _pop(const TransactionResolveResult(reloadNeeded: true));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Receipt upload failed: $e';
        _uploadingReceipt = false;
      });
    }
  }

  Future<void> _resolve(bool approve) async {
    setState(() {
      _resolving = true;
      _resolveAttempted = true;
      _error = null;
    });
    try {
      final newStatus =
          await _repo.resolvePayment(id: widget.tx.id, approve: approve);
      if (!mounted) return;
      _pop(TransactionResolveResult(newStatus: newStatus));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _resolving = false;
      });
      _repo.fetchTransactions().then((txs) {
        final match = txs.where((t) => t.id == widget.tx.id);
        if (match.isNotEmpty && mounted) {
          final status = match.first.status;
          setState(() => _currentStatus = status);
          widget.onStatusChanged?.call(status);
        }
      }).catchError((_) {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final tx = widget.tx;
    final isAdmin = api.isAdmin;
    final canResolve = isAdmin && _currentStatus == PaymentStatus.pending;
    final bottomPad = MediaQuery.of(context).viewInsets.bottom;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _pop(_resolveAttempted
              ? const TransactionResolveResult(reloadNeeded: true)
              : null);
        }
      },
      child: ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.88,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            margin: const EdgeInsets.symmetric(vertical: 8),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: cs.onSurfaceVariant.withValues(alpha: 0.4),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(16, 4, 16, 16 + bottomPad),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('Payment Request',
                          style: tt.titleLarge),
                    ),
                    _StatusBadge(status: _currentStatus),
                  ],
                ),
                const SizedBox(height: 16),

                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!,
                        style: const TextStyle(color: Color(0xFFEF4444))),
                  ),

                _DetailRow(label: 'Requested by',
                    value: tx.createdByName ?? '—'),
                _DetailRow(
                    label: 'Method',
                    value: tx.paymentMethod == 'bk'
                        ? (tx.isBankAccountPayment
                            ? 'Bank of Kigali (vendor)'
                            : 'Bank of Kigali (employee phone)')
                        : 'MoMo'),
                if (tx.isBankAccountPayment) ...[
                  _DetailRow(label: 'Account No.',
                      value: tx.bankAccountNumber ?? '—', mono: true),
                  _DetailRow(label: 'Account Name',
                      value: tx.bankAccountName ?? '—'),
                  _DetailRow(label: 'TIN', value: tx.tinNumber ?? '—', mono: true),
                ] else ...[
                  if (tx.recipientName?.isNotEmpty ?? false)
                    _DetailRow(label: 'Recipient name', value: tx.recipientName!),
                  _DetailRow(label: 'Recipient',
                      value: tx.recipientPhone ?? '—', mono: true),
                ],
                if (tx.locationName != null)
                  _DetailRow(label: 'Location', value: tx.locationName!),
                _DetailRow(
                    label: 'Date',
                    value: _fmtDateTime(tx.createdAt)),

                if (tx.products.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('Items', style: tt.titleSmall),
                  const SizedBox(height: 8),
                  ProductsTable(products: tx.products),
                  // Purchased item photos (web parity)
                  _ItemPhotos(products: tx.products),
                ],

                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Total',
                        style: tt.bodyLarge
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    Text(
                      formatRwf(tx.amount),
                      style: tt.bodyLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: cs.primary),
                    ),
                  ],
                ),

                if (canResolve) ...[
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _resolving ? null : () => _resolve(false),
                          icon: const Icon(Icons.close, size: 18),
                          label: const Text('Reject'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFFEF4444),
                            side: const BorderSide(
                                color: Color(0xFFEF4444), width: 1),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: _resolving ? null : () => _resolve(true),
                          icon: _resolving
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white),
                                )
                              : const Icon(Icons.check, size: 18),
                          label: Text(
                              _resolving ? 'Approving…' : 'Approve'),
                        ),
                      ),
                    ],
                  ),
                ],
              if (_currentStatus == PaymentStatus.completed &&
                  tx.receiptPhoto == null &&
                  tx.createdByName == api.currentFullName)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_receiptPreview == null)
                        FilledButton.icon(
                          onPressed:
                              _uploadingReceipt ? null : _captureReceipt,
                          icon: _uploadingReceipt
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.receipt_long_outlined,
                                  size: 18),
                          label: Text(_uploadingReceipt
                              ? 'Opening camera…'
                              : 'Upload receipt photo'),
                        )
                      else ...[
                        ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Image.memory(
                            _receiptPreview!,
                            fit: BoxFit.cover,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed:
                                    _uploadingReceipt ? null : _captureReceipt,
                                child: const Text('Retake'),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: FilledButton(
                                onPressed: _uploadingReceipt
                                    ? null
                                    : _submitReceipt,
                                child: _uploadingReceipt
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white),
                                      )
                                    : const Text('Submit receipt'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ));
  }

  String _fmtDateTime(DateTime dt) {
    String pad(int n) => n.toString().padLeft(2, '0');
    return '${dt.day}/${dt.month}/${dt.year} '
        '${pad(dt.hour)}:${pad(dt.minute)}';
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(
      {required this.label, required this.value, this.mono = false});
  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: TextStyle(
                    color: cs.onSurfaceVariant, fontSize: 13)),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                fontFamily: mono ? 'monospace' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final PaymentStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      PaymentStatus.pending => (const Color(0xFFF59E0B), 'Pending'),
      PaymentStatus.processing => (const Color(0xFF3B82F6), 'Processing'),
      PaymentStatus.completed => (const Color(0xFF22C55E), 'Approved'),
      PaymentStatus.failed => (const Color(0xFFEF4444), 'Failed'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: StatusColors.text(context, color))),
    );
  }
}

class _ItemPhotos extends StatelessWidget {
  const _ItemPhotos({required this.products});
  final List<PaymentProduct> products;

  @override
  Widget build(BuildContext context) {
    final photos = products.where((p) => p.imageBase64 != null).toList();
    if (photos.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SizedBox(
        height: 96,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: photos.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) => GestureDetector(
            onTap: () => showDialog(
              context: context,
              builder: (_) => Dismissible(
                key: const Key('p'),
                direction: DismissDirection.down,
                onDismissed: (_) => Navigator.of(context).pop(),
                child: Scaffold(
                  backgroundColor: Colors.black,
                  body: Stack(
                    children: [
                      Center(
                        child: InteractiveViewer(
                          child: Image.memory(
                            base64Decode(photos[i].imageBase64!.split(',').last),
                            fit: BoxFit.contain,
                          ),
                        ),
                      ),
                      Positioned(
                        top: 40,
                        right: 16,
                        child: IconButton(
                          tooltip: 'Close',
                          icon: const Icon(Icons.close, color: Colors.white),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(
                base64Decode(photos[i].imageBase64!.split(',').last),
                width: 96,
                height: 96,
                fit: BoxFit.cover,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
