import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface AuthConfig {
  /** True when GOOGLE_CLIENT_ID is set on the server */
  googleEnabled: boolean;
  /** The OAuth 2.0 client ID — safe to expose to the browser */
  googleClientId: string | null;
  /** Domains allowed to sign in, e.g. ["6dtech.co.in"]. Empty = any domain. */
  allowedDomains: string[];
}

/**
 * useAuthConfig — fetches server-side auth configuration at runtime.
 *
 * Uses GET /api/auth/config (public, no JWT needed).
 * Result is cached permanently for the session — the server config
 * doesn't change at runtime.
 *
 * This approach works cleanly in Docker because the client ID comes from
 * the server at runtime instead of being baked into the JS bundle at build time.
 */
export function useAuthConfig() {
  return useQuery<AuthConfig>({
    queryKey: ['auth-config'],
    queryFn: async () => {
      const res = await api.get<AuthConfig>('/auth/config');
      return res.data;
    },
    staleTime: Infinity,   // config never changes while the app is running
    gcTime:    Infinity,
    retry: 2,
  });
}
