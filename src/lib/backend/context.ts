import { createContext, useContext } from 'react';
import type { Backend } from './types';

export const BackendContext = createContext<Backend | null>(null);

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error('useBackend() used outside <BackendContext.Provider>');
  return b;
}
