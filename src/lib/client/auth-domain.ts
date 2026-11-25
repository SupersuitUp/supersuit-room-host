// SIGN-IN THROUGH OUR OWN HOST (2026-11-25). Google's account chooser says "continue to <authDomain>",
// and with the project default it read "continue to <project>.firebaseapp.com", a name no member
// knows. Firebase's documented fix for a site not on Firebase Hosting (option 3 of "Best practices for
// using signInWithRedirect on browsers that block third-party storage access") is to set authDomain to
// the site's own host and proxy /__/auth/* to <project>.firebaseapp.com, transparently.
//
// Each host listed here needs https://<host>/__/auth/handler as an authorized redirect URI on the
// project's Google OAuth web client, or Google refuses the sign-in. Previews and localhost keep
// NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN. A fork on its own domain lists that domain here.
export const OWN_AUTH_HOSTS = ['rooms.supersuit.co']

/** The authDomain for a page served on `host`: itself when it proxies /__/auth, else `fallback`. */
export function authDomainFor<T extends string | undefined>(host: string | undefined, fallback: T): string | T {
  return host && OWN_AUTH_HOSTS.includes(host) ? host : fallback
}

/** The rewrite that serves Firebase's sign-in handler from this host. Import-free: next.config loads it. */
export function authProxyRewrites(projectId: string | undefined) {
  return projectId
    ? [{ source: '/__/auth/:path*', destination: `https://${projectId}.firebaseapp.com/__/auth/:path*` }]
    : []
}
