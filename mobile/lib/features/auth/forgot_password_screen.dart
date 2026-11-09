import 'package:flutter/material.dart';

import '../../config/api_client.dart';

/// E2 — password reset on mobile (web parity).
///
/// The everyday path is one step: enter your email and the password you want,
/// and the API emails you to confirm it. Nothing changes until you tap the link
/// in that mail, which is what makes it safe for a signed-out form to choose a
/// password at all — and the same mail carries a link to refuse it.
///
/// The older code-paste path is kept underneath for links already sitting in
/// inboxes: request a plain reset link, then paste its `token=` value here with
/// a new password. Both endpoints are public.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _requestFormKey = GlobalKey<FormState>();
  final _resetFormKey = GlobalKey<FormState>();

  final _emailController = TextEditingController();
  final _tokenController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  // The code-paste path has its own password fields, so a half-filled main form
  // cannot leak into it.
  final _codePasswordController = TextEditingController();
  final _codeConfirmController = TextEditingController();

  bool _loading = false;
  // Reveals the older paste-a-code path. Off by default: it exists for links
  // already in inboxes, not as the way in.
  bool _showReset = false;
  // Set once the confirmation mail has gone out, so the screen can say so
  // instead of leaving the form looking untouched.
  bool _sent = false;

  @override
  void dispose() {
    _emailController.dispose();
    _tokenController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    _codePasswordController.dispose();
    _codeConfirmController.dispose();
    super.dispose();
  }

  Future<void> _sendResetEmail() async {
    if (!_requestFormKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final message = await ApiClient.instance.requestPasswordReset(
        _emailController.text.trim(),
        newPassword: _passwordController.text,
      );
      if (!mounted) return;
      setState(() => _sent = true);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resetPassword() async {
    if (!_resetFormKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ApiClient.instance.resetPassword(
        _tokenController.text.trim(),
        _codePasswordController.text,
      );
      if (!mounted) return;
      // Back to the login screen with a confirmation.
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password reset. You can now sign in.')),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // --- Step 1: request a reset email -----------------------
                  Form(
                    key: _requestFormKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          _sent
                              ? 'Check your email and tap the link to confirm. Your '
                                  'password stays as it is until you do — and the same '
                                  'email can refuse the change if it wasn\'t you.'
                              : 'Enter your email and the password you want. We\'ll '
                                  'email you to confirm it\'s really you.',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _emailController,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            border: OutlineInputBorder(),
                          ),
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email],
                          validator: (v) => v == null || !v.contains('@')
                              ? 'Enter a valid email'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _passwordController,
                          decoration: const InputDecoration(
                            labelText: 'New password',
                            border: OutlineInputBorder(),
                          ),
                          obscureText: true,
                          autofillHints: const [AutofillHints.newPassword],
                          validator: (v) => v == null || v.length < 6
                              ? 'At least 6 characters'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: _confirmController,
                          decoration: const InputDecoration(
                            labelText: 'Confirm new password',
                            border: OutlineInputBorder(),
                          ),
                          obscureText: true,
                          validator: (v) => v != _passwordController.text
                              ? 'Passwords do not match'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _loading ? null : _sendResetEmail,
                          child: _loading
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Text(_sent
                                  ? 'Send the email again'
                                  : 'Email me to confirm'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (!_showReset)
                    TextButton(
                      onPressed: _loading
                          ? null
                          : () => setState(() => _showReset = true),
                      child: const Text('I already have a reset code'),
                    ),

                  // --- Step 2: enter the token + new password --------------
                  if (_showReset) ...[
                    const Divider(height: 32),
                    Text(
                      'Paste the code from the email and choose a new password.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 16),
                    Form(
                      key: _resetFormKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextFormField(
                            controller: _tokenController,
                            decoration: const InputDecoration(
                              labelText: 'Reset code',
                              border: OutlineInputBorder(),
                            ),
                            validator: (v) => v == null || v.trim().isEmpty
                                ? 'Paste the code from your email'
                                : null,
                          ),
                          const SizedBox(height: 16),
                          TextFormField(
                            controller: _codePasswordController,
                            decoration: const InputDecoration(
                              labelText: 'New password',
                              border: OutlineInputBorder(),
                            ),
                            obscureText: true,
                            autofillHints: const [AutofillHints.newPassword],
                            validator: (v) => v == null || v.length < 6
                                ? 'At least 6 characters'
                                : null,
                          ),
                          const SizedBox(height: 16),
                          TextFormField(
                            controller: _codeConfirmController,
                            decoration: const InputDecoration(
                              labelText: 'Confirm new password',
                              border: OutlineInputBorder(),
                            ),
                            obscureText: true,
                            validator: (v) => v != _codePasswordController.text
                                ? 'Passwords do not match'
                                : null,
                          ),
                          const SizedBox(height: 24),
                          FilledButton(
                            onPressed: _loading ? null : _resetPassword,
                            child: _loading
                                ? const SizedBox(
                                    height: 18,
                                    width: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Text('Reset password'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
