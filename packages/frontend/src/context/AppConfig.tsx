import React, { createContext, useContext, useEffect, useState } from 'react';

type AppMode = 'full' | 'runner';

interface AppConfig {
  mode: AppMode;
  isReady: boolean;
}

const AppConfigContext = createContext<AppConfig>({ mode: 'full', isReady: false });

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>({ mode: 'full', isReady: false });

  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((data) => setConfig({ mode: data.mode ?? 'full', isReady: true }))
      .catch(() => setConfig({ mode: 'full', isReady: true }));
  }, []);

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
