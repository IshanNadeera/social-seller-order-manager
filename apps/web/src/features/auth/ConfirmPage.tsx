import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { linkClass } from '../../components/form';
import { strings } from '../../lib/strings';
import { useAuth } from './AuthProvider';
import { authErrorCode, authErrorMessage } from './auth-errors';
import { HOME_PATH } from './redirect';

const s = strings.auth;

export const RESET_PASSWORD_PATH = '/auth/reset-password';

/** Link types our email templates send (supabase/templates/*.html). "signup" is the older name. */
const LINK_TYPES = { email: 'email', signup: 'email', recovery: 'recovery' } as const;
type LinkType = (typeof LINK_TYPES)[keyof typeof LINK_TYPES];

function linkTypeOf(value: string | null): LinkType | null {
  return value !== null && Object.hasOwn(LINK_TYPES, value)
    ? LINK_TYPES[value as keyof typeof LINK_TYPES]
    : null;
}

type Outcome =
  | { kind: 'verifying' }
  | { kind: 'invalid' }
  | { kind: 'failed'; expired: boolean; message: string };

/**
 * Target of the links in our confirmation and password-reset emails:
 *   /auth/confirm?token_hash=…&type=email|recovery
 * Calls verifyOtp once; on success the seller is signed in and moves on (dashboard, or the
 * new-password form for a reset). The token is removed from the address bar either way.
 */
export function ConfirmPage() {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = linkTypeOf(params.get('type'));
  const [outcome, setOutcome] = useState<Outcome>(
    tokenHash && type ? { kind: 'verifying' } : { kind: 'invalid' },
  );
  // A link works once. React's development double-run of effects must not spend it twice.
  const started = useRef(false);

  useEffect(() => {
    if (!tokenHash || !type || started.current) return;
    started.current = true;
    const verify = async () => {
      try {
        const { error } = await client.verifyOtp({ token_hash: tokenHash, type });
        if (error) {
          setOutcome({
            kind: 'failed',
            expired: authErrorCode(error) === 'otp_expired',
            message: authErrorMessage(error),
          });
          return;
        }
        void navigate(type === 'recovery' ? RESET_PASSWORD_PATH : HOME_PATH, { replace: true });
      } catch (thrown) {
        setOutcome({ kind: 'failed', expired: false, message: authErrorMessage(thrown) });
      }
    };
    void verify();
  }, [client, navigate, tokenHash, type]);

  if (outcome.kind === 'verifying') {
    return (
      <p role="status" aria-live="polite">
        {s.confirm.verifying}
      </p>
    );
  }

  const title =
    outcome.kind === 'failed' && outcome.expired ? s.confirm.expiredTitle : s.confirm.invalidTitle;
  const body =
    outcome.kind === 'invalid'
      ? s.confirm.invalidBody
      : outcome.expired
        ? s.confirm.expiredBody
        : outcome.message;

  return (
    <>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p role="alert">{body}</p>
      <div className="space-y-2 text-sm">
        {type === 'recovery' && (
          <p>
            <Link to="/forgot-password" className={linkClass}>
              {s.confirm.requestNewReset}
            </Link>
          </p>
        )}
        <p>
          <Link to="/login" className={linkClass}>
            {s.confirm.goToLogin}
          </Link>
        </p>
      </div>
    </>
  );
}
