#!/bin/sh
# Build the API with tsc, and when it fails say WHY in a form a build log cannot
# swallow. Railway's build showed `tsc` exiting 2 (type errors) while printing
# nothing, so on failure this prints, on lines prefixed BUILDDIAG: the exit code,
# how many lines tsc wrote, tsc's own output, the same output as one base64 line,
# whether a no-emit compile also fails, and what reached dist/.
# A passing build prints nothing extra.
out="$(mktemp)"
tsc -p tsconfig.json --pretty false >"$out" 2>&1
rc=$?
cat "$out"
if [ "$rc" -ne 0 ]; then
  echo "BUILDDIAG rc=$rc lines=$(wc -l <"$out" | tr -d ' ') node=$(node -v) tsc=$(tsc -v | tr -d '\n') NODE_ENV=$NODE_ENV"
  sed 's/^/BUILDDIAG| /' "$out" | head -80
  echo "BUILDDIAG_B64=$(head -c 6000 "$out" | base64 | tr -d '\n')"
  tsc -p tsconfig.json --noEmit --pretty false >/dev/null 2>&1
  echo "BUILDDIAG noEmit_rc=$?"
  # Are the files tsc complained about readable text? (A file of NUL bytes reads
  # as one line where every character is "invalid".)
  for f in $(sed -n 's#^\([^(]*\)(.*#\1#p' "$out" | sort -u | head -5); do
    echo "BUILDDIAG file $f size=$(wc -c <"$f" | tr -d ' ') nul_bytes=$(tr -cd '\000' <"$f" | wc -c | tr -d ' ') first_bytes=$(head -c 24 "$f" | od -An -tx1 | tr -d '\n')"
  done
  echo "BUILDDIAG dist files: $(find dist -type f 2>/dev/null | wc -l | tr -d ' ')"
fi
exit "$rc"
