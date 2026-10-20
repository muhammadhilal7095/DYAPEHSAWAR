import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorBox, Input, KV, Notice, PageHeader, useFormErrors, useToast } from '../components/ui';
import { PASSWORD_HINT } from './auth/ResetPassword';

export default function Profile() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, formError, capture, clear, setErrors } = useFormErrors();
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clear();
    if (pw !== pw2) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur, newPassword: pw });
      toast('success', 'Password changed. Other sessions were signed out.');
      setCur(''); setPw(''); setPw2('');
      await refresh();
    } catch (e) {
      capture(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="My account" />
      {(sp.get('first') || me?.mustChangePassword) && <div className="mb-4"><Notice tone="warning">Please set a new password before continuing. Your account was created with a temporary password.</Notice></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <KV items={[['Name', me?.name], ['Email', me?.email], ['Designation', me?.designation], ['District / HQ', me?.district?.name], ['Roles', me?.roles.map((r) => r.name).join(', ')]]} cols={1} />
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="space-y-3" noValidate>
            <ErrorBox error={formError ? { message: formError } : null} />
            <Input label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={errors.currentPassword} required />
            <Input label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errors.newPassword} hint={PASSWORD_HINT} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={errors.confirm} required />
            <Button type="submit" loading={busy}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
