// The Verlet auth blocks (Login01/Register01) render their own full-screen
// centered layout and logo, so this group layout is just a passthrough.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
