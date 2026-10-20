import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { setTimezone } from './format';

export interface Me {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  districtId: string | null;
  district: { id: string; name: string } | null;
  roles: { id: string; key: string; name: string }[];
  permissions: string[];
  mustChangePassword: boolean;
}
export interface PublicSettings {
  orgName: string;
  orgSubtitle: string;
  logoFileId: string | null;
  themeColor: string;
  timezone: string;
  maxUploadMb: number;
  participantTotalFields: string[];
  jmCertificationStatement: string;
  sessionIdleMinutes: number;
}

interface AuthState {
  me: Me | null;
  settings: PublicSettings | null;
  loading: boolean;
  expired: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthState>(null as any);

export function applyTheme(color?: string | null) {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--brand', color);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/me');
      setMe(r.user);
      setSettings(r.settings);
      setTimezone(r.settings.timezone);
      applyTheme(r.settings.themeColor);
      document.title = r.settings.orgName;
      setExpired(false);
    } catch {
      setMe(null);
      const pub = await api.get('/api/public/settings').catch(() => null);
      if (pub) {
        applyTheme(pub.themeColor);
        setSettings((s) => ({ ...(s ?? ({} as any)), ...pub }));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => {
      setMe((m) => {
        if (m) setExpired(true);
        return null;
      });
    });
  }, [refresh]);

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setMe(null);
  };
  const can = (...perms: string[]) => !!me && perms.some((p) => me.permissions.includes(p));

  return <Ctx.Provider value={{ me, settings, loading, expired, refresh, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
