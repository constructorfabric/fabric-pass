import * as client from 'openid-client'
import { z } from 'zod'
import { env } from '@/lib/env'
import type { AuthRequest, Identity, Provider } from '@/lib/providers/types'

// `name` and `email` are both already part of GitHub's public profile
// response with no scope requested at all — `email` specifically mirrors
// whichever address (if any) the account holder has chosen to make public,
// not their verified/private one, which would need the `user:email` scope.
const profileSchema = z.object({
  id: z.number(),
  login: z.string().min(1),
  name: z.string().min(1).nullish(),
  email: z.string().min(1).nullish(),
})

export function toIdentity(profile: unknown): Identity {
  const parsed = profileSchema.parse(profile)
  return {
    providerId: String(parsed.id),
    username: parsed.login,
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.email ? { email: parsed.email } : {}),
  }
}

/**
 * GitHub answers the token endpoint with form-encoded data unless the request
 * asks for JSON, so every request from this client carries the header.
 *
 * This also corrects `redirect_uri` on the token exchange. `openid-client`
 * derives that parameter from `currentUrl` — the request URL as the app sees
 * it, which behind a reverse proxy or tunnel differs in scheme and/or host
 * from the URL actually registered with GitHub. GitHub's authorize endpoint
 * accepts subpaths of the registered URL, so the authorization step never
 * catches this; its token endpoint requires an exact match, so the callback
 * with the deriving-config still passing `tokenEndpointParameters.redirect_uri`
 * has no effect — the library sets `redirect_uri` from the callback URL after
 * merging any additional parameters, silently overriding it. Rewriting the
 * body here, after that overwrite, is the only point that sticks (see
 * `openid-client`'s `customFetch` doc, "Correcting redirect_uri for Token
 * Endpoint").
 */
function tokenFetch(registeredRedirectUri: string): client.CustomFetch {
  return (url, options) => {
    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')

    if (options.body instanceof URLSearchParams && options.body.get('grant_type') === 'authorization_code') {
      options.body.set('redirect_uri', registeredRedirectUri)
    }

    return fetch(url, { ...options, headers } as RequestInit)
  }
}

// GitHub's callback started including an `iss` (RFC 9207 issuer
// identification) query parameter, and `oauth4webapi` (which `openid-client`
// delegates to) rejects the callback outright whenever a present `iss`
// doesn't exactly equal this config's own `issuer` — it doesn't matter that
// GitHub isn't a real discovery-compliant OIDC provider here, or that
// `issuer` isn't used to derive `authorization_endpoint`/`token_endpoint`
// (both are given explicitly below, independent of it). Confirmed directly
// against production logs of real callbacks: GitHub sends
// `iss=https://github.com/login/oauth`, not the bare origin — every sign-in
// failed with "unexpected iss (issuer) response parameter value" (expected
// 'https://github.com') until this matched what GitHub actually sends.
// Exported only so github.test.ts can pin the exact `issuer` value against a
// regression — every other caller reaches this through authRequest/callback
// below.
export function configuration(registeredRedirectUri: string): client.Configuration {
  const config = new client.Configuration(
    {
      issuer: 'https://github.com/login/oauth',
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
    },
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
  )
  config[client.customFetch] = tokenFetch(registeredRedirectUri)
  return config
}

export const github: Provider = {
  name: 'github',

  async authRequest(redirectUri: string): Promise<AuthRequest> {
    const config = configuration(redirectUri)
    const codeVerifier = client.randomPKCECodeVerifier()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const state = client.randomState()

    // No scope: an empty scope already grants read access to the public
    // profile, which is where `login` lives. Anything more would be surplus.
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return { url, codeVerifier, state }
  },

  async callback(currentUrl, redirectUri, codeVerifier, state): Promise<Identity> {
    const config = configuration(redirectUri)
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
    })

    const response = await client.fetchProtectedResource(
      config,
      tokens.access_token,
      new URL('https://api.github.com/user'),
      'GET',
    )

    return toIdentity(await response.json())
  },
}
