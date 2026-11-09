import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'roles.dart' as roles;
import 'roles.dart' show isAdminRole;

/// Error thrown for non-2xx API responses, carrying the API's message.
class ApiException implements Exception {
  ApiException(this.status, this.message, [this.code]);
  final int status;
  final String message;
  final String? code;

  @override
  String toString() => message;
}

/// Single client the whole app uses to talk to the shared inventory-api.
///
/// Holds the session in secure storage, attaches the Bearer token to every
/// request, and transparently refreshes once on a 401. [isAuthenticated] drives
/// the auth gate; the current user's profile (role/name) is loaded from
/// /auth/me after login and on restore.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _accessKey = 'sb-access-token';
  static const _refreshKey = 'sb-refresh-token';

  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  String? _accessToken;
  String? _refreshToken;

  String? _currentEmail;
  String? _currentUserId;
  String? _currentFullName;
  String _role = 'member';
  bool _canManageInventory = false;
  bool _hasPaymentPermission = false;
  String _fallbackRole = 'none';

  /// Whether a session is currently active. The auth gate listens to this.
  final ValueNotifier<bool> isAuthenticated = ValueNotifier<bool>(false);

  String? get currentEmail => _currentEmail;
  String? get currentUserId => _currentUserId;
  String? get currentFullName => _currentFullName;
  String get role => _role;
  bool get isAdmin => isAdminRole(_role);

  /// Runs the warehouse: items, locations, stock and the stock reports.
  /// A stock manager by role, or a member granted `can_manage_inventory`.
  bool get canManageInventory =>
      roles.canManageInventory(role: _role, canManageInventoryFlag: _canManageInventory);

  /// Granted the payments area individually, without being admin or cashier.
  bool get hasPaymentPermission => _hasPaymentPermission;

  /// Approve or reject a payment request — never a stock manager.
  bool get canApprovePayments =>
      roles.canApprovePayments(role: _role, fallbackRole: _fallbackRole);


  /// Compile-time override, e.g. `--dart-define=API_URL=http://10.0.2.2:4001`
  /// to point a build at the test environment. Falls back to the bundled
  /// `.env`, then the emulator->host default.
  ///
  /// **Release builds must pass `--dart-define`.** `.env` is gitignored, so it
  /// is not present in CI or on a fresh clone, and the default below points at
  /// the Android emulator's host loopback — useless on a real device.
  static const _dartDefineApiUrl = String.fromEnvironment('API_URL');

  String get _baseUrl {
    if (_dartDefineApiUrl.isNotEmpty) return _dartDefineApiUrl;
    // dotenv.env throws if load() never succeeded, which is exactly the case
    // when .env is missing — check before reading rather than letting every
    // request blow up.
    if (dotenv.isInitialized) {
      final fromFile = dotenv.env['API_URL'];
      if (fromFile != null && fromFile.isNotEmpty) return fromFile;
    }
    return 'http://10.0.2.2:4000';
  }

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Map<String, String> _headers({bool json = false}) => {
        if (json) 'Content-Type': 'application/json',
        if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      };

  /// Restore a persisted session at startup and load the profile.
  Future<void> restore() async {
    _accessToken = await _storage.read(key: _accessKey);
    _refreshToken = await _storage.read(key: _refreshKey);
    if (_accessToken != null) {
      await _loadMe();
      isAuthenticated.value = true;
    } else {
      isAuthenticated.value = false;
    }
  }

  // --- Auth ---------------------------------------------------------------

  Future<void> login(String email, String password) async {
    final body = await _unauthed('/auth/login', {
      'email': email,
      'password': password,
    });
    await _persist(body['session'] as Map<String, dynamic>);
    await _loadMe(); // load role before the shell reads it
    isAuthenticated.value = true;
  }

  /// Returns true if signup logged the user straight in.
  Future<bool> signup(String email, String password, String fullName) async {
    final body = await _unauthed('/auth/signup', {
      'email': email,
      'password': password,
      'full_name': fullName,
    });
    final session = body['session'];
    final user = body['user'] as Map<String, dynamic>?;
    // E3: accounts start UNVERIFIED. Only activate the session if the server
    // reports the email as confirmed (email_confirmed_at is non-null). A
    // false return tells the UI to show "check your email" instead of home.
    final confirmedAt = user?['email_confirmed_at'];
    final verified = confirmedAt != null;
    if (session is Map<String, dynamic> && verified) {
      await _persist(session);
      await _loadMe(); // load role before the shell reads it
      isAuthenticated.value = true;
      return true;
    }
    await _clear();
    return false;
  }

  /// Confirm an email address from the link sent on signup (E3).
  /// [token] comes from the verification email.
  Future<void> verifyEmail(String token) async {
    await post('/auth/verify-email', {'token': token});
  }

  /// Re-send the signup verification email (E3). The recovery path when the
  /// original send failed or the 24h link expired — without it an unverified
  /// account can never sign in. Always succeeds (no user enumeration); returns
  /// the server's neutral message.
  Future<String> resendVerification(String email) async {
    final body = await _unauthed('/auth/resend-verification', {'email': email});
    return body['message'] as String? ??
        'If that account still needs verifying, a new link has been sent.';
  }

  /// Request a password change (E2). The server always responds 200 (no user
  /// enumeration), so the UI must show a neutral "check your inbox" message
  /// either way. Returns the server's message string.
  ///
  /// Pass [newPassword] and the emailed link asks the account owner to confirm
  /// that exact password — nothing changes until they do. Leave it out and the
  /// mail carries a code to paste into [resetPassword] instead.
  Future<String> requestPasswordReset(String email, {String? newPassword}) async {
    final body = await _unauthed('/auth/forgot-password', {
      'email': email,
      if (newPassword != null) 'new_password': newPassword,
    });
    return body['message'] as String? ??
        'If that account exists, check your email.';
  }

  /// Consume a single-use reset [token] (from the email) and set [newPassword]
  /// (E2). Throws [ApiException] on an invalid / expired / already-used token.
  Future<void> resetPassword(String token, String newPassword) async {
    await _unauthed('/auth/reset-password', {
      'token': token,
      'new_password': newPassword,
    });
  }

  Future<void> logout() async {
    try {
      if (_accessToken != null) {
        await http.post(_uri('/auth/logout'), headers: _headers());
      }
    } catch (_) {
      // Best effort.
    }
    await _clear();
  }

  Future<void> _loadMe() async {
    try {
      final me = await get('/auth/me') as Map<String, dynamic>;
      final user = me['user'] as Map<String, dynamic>?;
      final profile = me['profile'] as Map<String, dynamic>?;
      _currentEmail = user?['email'] as String?;
      _currentUserId = user?['id'] as String?;
      _currentFullName = profile?['full_name'] as String?;
      _role = (profile?['role'] as String?) ?? 'member';
      _canManageInventory = (profile?['can_manage_inventory'] as bool?) ?? false;
      _hasPaymentPermission = (profile?['has_payment_permission'] as bool?) ?? false;
      _fallbackRole = (profile?['fallback_role'] as String?) ?? 'none';
    } catch (_) {
      // Leave defaults; a failed refresh path clears the session.
    }
  }

  /// Update the signed-in user's own display name and/or email. Email changes
  /// require the API's service-role key (server enforces). Refreshes the cached
  /// name/email from the response.
  Future<void> updateProfile({String? fullName, String? email}) async {
    final body = <String, dynamic>{
      if (fullName != null) 'full_name': fullName,
      if (email != null) 'email': email,
    };
    final res = await patch('/profiles/me', body) as Map<String, dynamic>;
    _currentFullName = res['full_name'] as String? ?? _currentFullName;
    _currentEmail = res['email'] as String? ?? _currentEmail;
  }

  /// Change the signed-in user's password. The server verifies [current]
  /// before applying [next].
  Future<void> changePassword(String current, String next) async {
    await post('/auth/change-password', {
      'current_password': current,
      'new_password': next,
    });
  }

  // --- Generic requests ---------------------------------------------------

  Future<dynamic> get(String path) => _request('GET', path);
  Future<String> getRaw(String path) async {
    final res = await _send('GET', path, null);
    if (res.statusCode == 401 && _refreshToken != null) {
      if (await _refresh()) {
        final r2 = await _send('GET', path, null);
        if (r2.statusCode >= 400) {
          final d = _decode(r2);
          throw ApiException(r2.statusCode, _errorMessage(d), _errorCode(d));
        }
        return r2.body;
      }
    }
    if (res.statusCode >= 400) {
      final d = _decode(res);
      throw ApiException(res.statusCode, _errorMessage(d), _errorCode(d));
    }
    return res.body;
  }
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _request('POST', path, body);
  Future<dynamic> patch(String path, [Map<String, dynamic>? body]) =>
      _request('PATCH', path, body);
  Future<dynamic> put(String path, [Map<String, dynamic>? body]) =>
      _request('PUT', path, body);
  Future<dynamic> delete(String path) => _request('DELETE', path);

  /// Upload raw file bytes as `multipart/form-data` (for endpoints backed by
  /// multer, e.g. the receipt upload) — the plain JSON `patch`/`post` above
  /// can't hit those.
  Future<dynamic> patchMultipart(
    String path, {
    required Uint8List bytes,
    required String filename,
    String field = 'file',
    String? contentType,
  }) =>
      _sendMultipart('PATCH', path,
          bytes: bytes, filename: filename, field: field, contentType: contentType);

  Future<dynamic> _sendMultipart(
    String method,
    String path, {
    required Uint8List bytes,
    required String filename,
    required String field,
    String? contentType,
    bool retried = false,
  }) async {
    final request = http.MultipartRequest(method, _uri(path))
      ..headers.addAll(_headers())
      ..files.add(http.MultipartFile.fromBytes(
        field,
        bytes,
        filename: filename,
        contentType: contentType != null ? MediaType.parse(contentType) : null,
      ));

    final res = await http.Response.fromStream(await request.send());

    if (res.statusCode == 401 && !retried && _refreshToken != null) {
      if (await _refresh()) {
        return _sendMultipart(method, path,
            bytes: bytes, filename: filename, field: field, contentType: contentType, retried: true);
      }
    }

    final decoded = _decode(res);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorMessage(decoded), _errorCode(decoded));
    }
    return decoded;
  }

  /// Absolute URL for a path — used by Image.network, which fetches outside
  /// this client and so needs the base URL and auth header spelled out.
  String urlFor(String path) => '$_baseUrl$path';

  /// Headers for a direct fetch (e.g. Image.network) that bypasses _request.
  Map<String, String> get authHeaders => _headers();

  Future<dynamic> _request(
    String method,
    String path, [
    Map<String, dynamic>? body,
    bool retried = false,
  ]) async {
    final res = await _send(method, path, body);

    if (res.statusCode == 401 && !retried && _refreshToken != null) {
      if (await _refresh()) {
        return _request(method, path, body, true);
      }
    }

    final decoded = _decode(res);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorMessage(decoded), _errorCode(decoded));
    }
    return decoded;
  }

  Future<http.Response> _send(String method, String path, Map<String, dynamic>? body) {
    final uri = _uri(path);
    final headers = _headers(json: body != null);
    final encoded = body != null ? jsonEncode(body) : null;
    switch (method) {
      case 'POST':
        return http.post(uri, headers: headers, body: encoded);
      case 'PATCH':
        return http.patch(uri, headers: headers, body: encoded);
      case 'DELETE':
        return http.delete(uri, headers: headers);
      case 'GET':
      default:
        return http.get(uri, headers: headers);
    }
  }

  // --- Session plumbing ---------------------------------------------------

  Future<Map<String, dynamic>> _unauthed(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      _uri(path),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    final decoded = _decode(res);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, _errorMessage(decoded), _errorCode(decoded));
    }
    return decoded as Map<String, dynamic>;
  }

  Future<bool> _refresh() async {
    try {
      final res = await http.post(
        _uri('/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refresh_token': _refreshToken}),
      );
      if (res.statusCode >= 400) {
        await _clear();
        return false;
      }
      await _persist((_decode(res) as Map<String, dynamic>)['session'] as Map<String, dynamic>);
      return true;
    } catch (_) {
      await _clear();
      return false;
    }
  }

  Future<void> _persist(Map<String, dynamic> session) async {
    _accessToken = session['access_token'] as String?;
    _refreshToken = session['refresh_token'] as String?;
    if (_accessToken != null) await _storage.write(key: _accessKey, value: _accessToken);
    if (_refreshToken != null) await _storage.write(key: _refreshKey, value: _refreshToken);
    // isAuthenticated is flipped by callers after the profile is loaded.
  }

  Future<void> _clear() async {
    _accessToken = null;
    _refreshToken = null;
    _currentEmail = null;
    _currentUserId = null;
    _currentFullName = null;
    _role = 'member';
    _canManageInventory = false;
    _hasPaymentPermission = false;
    _fallbackRole = 'none';
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    isAuthenticated.value = false;
  }

  dynamic _decode(http.Response res) {
    if (res.body.isEmpty) return <String, dynamic>{};
    return jsonDecode(res.body);
  }

  String _errorMessage(dynamic body) {
    if (body is! Map) return 'Request failed';
    final err = body['error'];
    String? message;
    if (err is Map && err['message'] is String) {
      message = err['message'] as String;
    } else if (err is String) {
      // Some routes (e.g. /payments/resolve) send {error: "...", reason: "..."}.
      message = err;
      if (body['reason'] is String) message = '$message (${body['reason']})';
    }
    if (message == null) return 'Request failed';
    final detail = _validationDetail(err);
    return detail == null ? message : '$message — $detail';
  }

  /// "name: Required; units_per_container: Number must be greater than 0" from
  /// a validation_error's `details.fieldErrors`, so a rejected form says WHICH
  /// field was wrong instead of only "Invalid request body."
  String? _validationDetail(dynamic err) {
    if (err is! Map || err['details'] is! Map) return null;
    final fields = (err['details'] as Map)['fieldErrors'];
    if (fields is! Map || fields.isEmpty) return null;
    final parts = <String>[];
    fields.forEach((k, v) {
      if (v is List && v.isNotEmpty) parts.add('$k: ${v.first}');
    });
    return parts.isEmpty ? null : parts.take(3).join('; ');
  }

  String? _errorCode(dynamic body) {
    if (body is Map && body['error'] is Map && body['error']['code'] is String) {
      return body['error']['code'] as String;
    }
    return null;
  }
}

/// Convenience accessor.
ApiClient get api => ApiClient.instance;
