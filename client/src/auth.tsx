import { createContext, useContext } from 'react';
import type { User } from './types';

export interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  setUser: () => undefined,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
