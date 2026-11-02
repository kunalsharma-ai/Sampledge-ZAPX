/**
 * A minimal OpenID Connect provider for tests (Milestone 8). It is not a real identity provider: it
 * issues RS256 ID tokens for whatever claims the test sets, checks PKCE and the client secret, and
 * can be told to misbehave (wrong audience, wrong nonce) to test that ZAPX refuses the sign-in.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

export interface MockLogin {
  claims: Record<string, unknown>;
  /** Overrides for testing refusals. */
  audience?: string;
  nonce?: string;
}

export class MockOidc {
  issuer = '';
  clientId = 'zapx-test-client';
  clientSecret = 'test-client-secret-123';
  private server?: Server;
  private key?: KeyLike;
  private jwk?: Record<string, unknown>;
  private codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; login: MockLogin }>();
  tokenRequests = 0;
  /** For browser tests: who "signs in" when the browser reaches /authorize. */
  nextLogin?: MockLogin;

  async start() {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.key = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  /** Plays the person signing in at the provider: returns the code the browser would bring back. */
  authorize(authUrl: string, login: MockLogin) {
    const u = new URL(authUrl);
    if (`${u.origin}${u.pathname}` !== `${this.issuer}/authorize`) throw new Error(`Unexpected authorize URL ${authUrl}`);
    if (u.searchParams.get('client_id') !== this.clientId) throw new Error('Wrong client_id');
    if (u.searchParams.get('code_challenge_method') !== 'S256') throw new Error('PKCE S256 required');
    const code = randomBytes(12).toString('hex');
    this.codes.set(code, {
      nonce: u.searchParams.get('nonce')!,
      challenge: u.searchParams.get('code_challenge')!,
      redirectUri: u.searchParams.get('redirect_uri')!,
      login,
    });
    return { code, state: u.searchParams.get('state')!, redirectUri: u.searchParams.get('redirect_uri')! };
  }

  private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', this.issuer).pathname;
    if (path === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }
    if (path === '/jwks') return json(200, { keys: [this.jwk] });
    if (path === '/authorize' && this.nextLogin) {
      const authUrl = new URL(req.url ?? '/', this.issuer).toString();
      const { code, state, redirectUri } = this.authorize(authUrl, this.nextLogin);
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', state);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (path === '/token' && req.method === 'POST') {
      this.tokenRequests++;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = this.codes.get(form.get('code') ?? '');
      if (!entry) return json(400, { error: 'invalid_grant', error_description: 'Unknown code' });
      this.codes.delete(form.get('code')!);
      if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret)
        return json(401, { error: 'invalid_client' });
      if (form.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' });
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      const idToken = await new SignJWT({ ...entry.login.claims, nonce: entry.login.nonce ?? entry.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(this.issuer)
        .setAudience(entry.login.audience ?? this.clientId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.key!);
      return json(200, { access_token: 'unused', token_type: 'Bearer', id_token: idToken });
    }
    json(404, { error: 'not_found' });
  }
}
