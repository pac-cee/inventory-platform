import 'package:flutter/material.dart';

import '../../config/api_client.dart';
import 'forgot_password_screen.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ApiClient.instance.login(
        _emailController.text.trim(),
        _passwordController.text,
      );
      // The auth gate (main.dart) swaps to the home screen automatically.
    } on ApiException catch (e) {
      if (mounted) {
        final unverified = e.code == 'email_not_verified';
        final message = unverified
            ? 'Please verify your email first — check your inbox for the link.'
            : e.message;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(message),
          duration: unverified ? const Duration(seconds: 8) : const Duration(seconds: 4),
          // An unverified account can never sign in, so offer the way out
          // rather than leaving the user stuck on this screen.
          action: unverified
              ? SnackBarAction(label: 'Resend', onPressed: _resendVerification)
              : null,
        ));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Send a fresh verification link to the address already typed in.
  Future<void> _resendVerification() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) return;
    try {
      final message = await ApiClient.instance.resendVerification(email);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Image.asset(
                          'assets/verlet_icon.png',
                          width: 56,
                          height: 56,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text('Inventory',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _emailController,
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      validator: (v) =>
                          v == null || !v.contains('@') ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      decoration: const InputDecoration(
                        labelText: 'Password',
                        border: OutlineInputBorder(),
                      ),
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      validator: (v) =>
                          v == null || v.length < 6 ? 'At least 6 characters' : null,
                    ),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _loading ? null : _signIn,
                      child: _loading
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Sign in'),
                    ),
                    const SizedBox(height: 4),
                    TextButton(
                      onPressed: _loading
                          ? null
                          : () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => const ForgotPasswordScreen(),
                              )),
                      child: const Text('Forgot password?'),
                    ),
                    TextButton(
                      onPressed: _loading
                          ? null
                          : () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => const SignupScreen(),
                              )),
                      child: const Text("Don't have an account? Create one"),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
