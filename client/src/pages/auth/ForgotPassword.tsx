import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Button, ErrorBox, Input, Notice } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post('/api/auth/forgot-password', { email });
      setDone(r.message);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We will email a reset link that is valid for 60 minutes.">
      {done ? (
        <div className="space-y-4">
          <Notice tone="success">{done}</Notice>
          <Link to="/login" className="text-sm font-medium text-brand hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <ErrorBox error={err} />
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
          <p className="text-center text-sm"><Link to="/login" className="font-medium text-brand hover:underline">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
