import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient } from './api-client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

/** The API client (lib/api-client.ts). Components never call fetch() themselves. */
export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) throw new Error('useApi must be used inside <ApiProvider>.');
  return client;
}
