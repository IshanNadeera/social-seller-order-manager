import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, readBootstrapConfig } from './bootstrap-config';

const WEB_ORIGIN = 'http://localhost:5173';

describe('readBootstrapConfig', () => {
  it('reads PORT and WEB_ORIGIN', () => {
    expect(readBootstrapConfig({ PORT: '4000', WEB_ORIGIN })).toEqual({
      port: 4000,
      webOrigin: WEB_ORIGIN,
    });
  });

  it.each([undefined, ''])('uses the default port when PORT is %j', (port) => {
    expect(readBootstrapConfig({ PORT: port, WEB_ORIGIN }).port).toBe(DEFAULT_PORT);
  });

  it.each(['abc', '0', '65536', '30.5', '-1', ' 3000'])('rejects PORT=%j', (port) => {
    expect(() => readBootstrapConfig({ PORT: port, WEB_ORIGIN })).toThrow(/PORT/);
  });

  it.each([undefined, ''])('requires WEB_ORIGIN (given %j)', (origin) => {
    expect(() => readBootstrapConfig({ WEB_ORIGIN: origin })).toThrow(/WEB_ORIGIN is required/);
  });

  it.each(['http://localhost:5173', 'https://app.example.com', 'https://app.example.com:8443'])(
    'accepts the exact origin %s',
    (origin) => {
      expect(readBootstrapConfig({ WEB_ORIGIN: origin }).webOrigin).toBe(origin);
    },
  );

  it.each([
    '*',
    'app.example.com',
    'https://app.example.com/',
    'https://app.example.com/login',
    'https://app.example.com:443',
    'https://user:pass@app.example.com',
    'ftp://app.example.com',
    'https://*.example.com',
  ])('rejects WEB_ORIGIN=%j', (origin) => {
    expect(() => readBootstrapConfig({ WEB_ORIGIN: origin })).toThrow(/exact origin/);
  });
});
