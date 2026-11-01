// Starts the real app (AppModule + configureApp) for HTTP tests that need no database: local signing
// keys, a fake account lookup, a fake Prisma, and a logger whose JSON lines are captured for checks.
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AccountService } from '../src/auth/account.service';
import type { AccountState } from '../src/auth/account.service';
import { JWKS } from '../src/auth/auth.module';
import { createLogger } from '../src/common/logging/logger';
import { PrismaService } from '../src/common/prisma.service';
import { fakePrisma } from './fake-prisma';
import { createTestAuth } from './test-auth';
import type { TestAuth } from './test-auth';
import { testEnv } from './test-env';

export const TEST_BUSINESS_ID = '5f0e7c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';

/** Every user signed by these tests is a member (OWNER) of TEST_BUSINESS_ID. */
class MemberAccountService {
  load(): Promise<AccountState> {
    return Promise.resolve({ status: 'member', businessId: TEST_BUSINESS_ID, role: 'OWNER' });
  }
}

export interface HttpTestApp {
  app: NestExpressApplication;
  auth: TestAuth;
  /** Raw JSON log lines written so far. */
  logLines: string[];
}

export async function startHttpTestApp(controllers: Type[]): Promise<HttpTestApp> {
  const auth = await createTestAuth(testEnv.SUPABASE_JWT_ISSUER);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv)],
    controllers,
  })
    .overrideProvider(JWKS)
    .useValue(auth.jwks)
    .overrideProvider(AccountService)
    .useValue(new MemberAccountService())
    .overrideProvider(PrismaService)
    .useValue(fakePrisma())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  const logLines: string[] = [];
  const logger = createLogger(
    { LOG_LEVEL: 'info' },
    {
      write: (line: string) => {
        logLines.push(line);
      },
    },
  );
  configureApp(app, testEnv, { logger });
  await app.init();
  return { app, auth, logLines };
}
