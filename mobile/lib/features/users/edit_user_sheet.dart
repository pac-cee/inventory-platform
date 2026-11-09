import 'package:flutter/material.dart';

import '../../models.dart';
import '../../payment_repository.dart';
import '../../repository.dart';

class EditUserSheet extends StatefulWidget {
  const EditUserSheet({super.key, required this.profile});

  final Profile profile;

  @override
  State<EditUserSheet> createState() => _EditUserSheetState();
}

class _EditUserSheetState extends State<EditUserSheet> {
  final _users = const UsersRepository();
  final _payments = const PaymentRepository();

  late final TextEditingController _name =
      TextEditingController(text: widget.profile.fullName ?? '');
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final TextEditingController _daily = TextEditingController(
      text: _limitText(widget.profile.dailyLimit));
  late final TextEditingController _monthly = TextEditingController(
      text: _limitText(widget.profile.monthlyLimit));
  late final TextEditingController _perTx = TextEditingController(
      text: _limitText(widget.profile.perTransactionLimit));

  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _daily.dispose();
    _monthly.dispose();
    _perTx.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final email = _email.text.trim();
    final password = _password.text;
    final dailyLimit = double.tryParse(_daily.text.trim()) ?? 0;
    final monthlyLimit = double.tryParse(_monthly.text.trim()) ?? 0;
    final perTxLimit = double.tryParse(_perTx.text.trim()) ?? 0;

    if (password.isNotEmpty && password.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      Profile base = widget.profile;
      final hasProfileChanges =
          (name != (widget.profile.fullName ?? '')) ||
          email.isNotEmpty ||
          password.isNotEmpty;
      if (hasProfileChanges) {
        base = await _users.updateUser(
          widget.profile.id,
          fullName: name,
          email: email,
          password: password,
        );
      }
      await _payments.setPaymentLimits(
        widget.profile.id,
        dailyLimit: dailyLimit,
        monthlyLimit: monthlyLimit,
        perTransactionLimit: perTxLimit,
      );
      final updated = Profile(
        id: base.id,
        role: base.role,
        fullName: base.fullName,
        blocked: base.blocked,
        hasPaymentPermission: base.hasPaymentPermission,
        dailyLimit: dailyLimit,
        monthlyLimit: monthlyLimit,
        perTransactionLimit: perTxLimit,
        createdAt: base.createdAt,
      );
      if (mounted) Navigator.pop(context, updated);
    } catch (e) {
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final tt = Theme.of(context).textTheme;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Edit ${widget.profile.fullName ?? 'user'}',
              style: tt.titleLarge),
          const SizedBox(height: 16),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFEF4444))),
            ),
          TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Full name')),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'Leave blank to keep current',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'New password',
              hintText: 'Leave blank to keep current',
            ),
          ),
          const SizedBox(height: 8),
          Text('Only the fields you fill in will change.',
              style: TextStyle(fontSize: 12, color: muted)),
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 12),
          Text('Payment limits', style: tt.titleSmall),
          const SizedBox(height: 4),
          Text('Set to 0 for no limit.',
              style: TextStyle(fontSize: 12, color: muted)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _daily,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Daily (RWF)',
                    hintText: '0',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _monthly,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Monthly (RWF)',
                    hintText: '0',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _perTx,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Per-tx (RWF)',
                    hintText: '0',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save changes'),
          ),
        ],
      ),
    );
  }
}

String _limitText(double? v) => (v != null && v > 0) ? v.round().toString() : '';
