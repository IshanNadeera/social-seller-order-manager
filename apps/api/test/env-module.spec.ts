// The validated environment is injectable anywhere in the app through the ENV token.
import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ENV } from '../src/common/env.module';
import type { Env } from '../src/common/env';
import { testEnv } from './test-env';

@Injectable()
class NeedsEnv {
  constructor(@Inject(ENV) readonly env: Env) {}
}

describe('EnvModule', () => {
  it('provides the validated environment to any provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testEnv)],
      providers: [NeedsEnv],
    }).compile();

    expect(moduleRef.get(ENV)).toBe(testEnv);
    expect(moduleRef.get(NeedsEnv).env.WEB_ORIGIN).toBe(testEnv.WEB_ORIGIN);
    await moduleRef.close();
  });
});
