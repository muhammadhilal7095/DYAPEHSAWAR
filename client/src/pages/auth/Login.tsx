import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogIn } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, ErrorBox, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function Login() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const next = sp.get('next') && sp.get('next')!.startsWith('/') ? sp.get('next')! : '/';
  if (me) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      nav(next, { replace: true });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use your official account to continue.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ErrorBox error={err} />
        <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex items-center justify-end text-sm">
          <Link to="/forgot-password" className="font-medium text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={busy} className="w-full" icon={<LogIn className="size-4" />}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
