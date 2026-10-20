import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import { Button, ErrorBox, Input, Notice, useFormErrors } from '../../components/ui';
import { AuthShell } from './AuthShell';

export const PASSWORD_HINT = 'At least 10 characters with upper- and lowercase letters and a number.';

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { errors, formError, capture, clear, setErrors } = useFormErrors();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clear();
    if (password !== confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token: sp.get('token'), password });
      setDone(true);
    } catch (e) {
      capture(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password">
      {done ? (
        <div className="space-y-4">
          <Notice tone="success">Your password has been changed. All other sessions were signed out.</Notice>
          <Link to="/login" className="text-sm font-medium text-brand hover:underline">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <ErrorBox error={formError ? { message: formError } : null} />
          <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={PASSWORD_HINT} required />
          <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} required />
          <Button type="submit" loading={busy} className="w-full">Set password</Button>
        </form>
      )}
    </AuthShell>
  );
}
