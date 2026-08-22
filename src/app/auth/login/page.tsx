// Minimal placeholder — real UI (form, error handling, user-enumeration
// safety) is M1-2 scope. This exists so /profile's redirect target
// resolves to a real 200 page, making the middleware test meaningful.
export default function LoginPage() {
  return (
    <main>
      <h1>Login</h1>
    </main>
  );
}
