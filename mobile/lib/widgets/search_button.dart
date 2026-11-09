import 'package:flutter/material.dart';

import '../features/search/search_screen.dart';

/// The search icon every tab's app bar carries, so finding equipment is one tap
/// from anywhere (the web app's top bar does the same).
class SearchButton extends StatelessWidget {
  const SearchButton({super.key});

  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: 'Search',
        icon: const Icon(Icons.search),
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const SearchScreen()),
        ),
      );
}
