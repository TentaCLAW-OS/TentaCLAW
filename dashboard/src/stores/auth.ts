import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'user';
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const TOKEN_KEY = 'tentaclaw_token';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  loading: true,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const msg = res.status === 401 ? 'Invalid credentials' : `Login failed (${res.status})`;
        set({ loading: false, error: msg });
        return false;
      }
      const data = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      set({ user: data.user, token: data.token, loading: false, error: null });
      return true;
    } catch {
      set({ loading: false, error: 'Network error — could not reach server' });
      return false;
    }
  },

  logout: async () => {
    const { token } = get();
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      // Ignore — clear local state regardless
    }
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null, loading: false, error: null });
  },

  checkAuth: async () => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      set({ loading: false });
      return;
    }
    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${stored}` },
      });
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        set({ user: null, token: null, loading: false });
        return;
      }
      const user = await res.json();
      set({ user, token: stored, loading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ user: null, token: null, loading: false });
    }
  },
}));
