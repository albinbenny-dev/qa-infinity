import React, { createContext, useContext, useEffect, useState } from 'react';

type AppMode = 'full' | 'runner';

interface AppConfig {
  mode: AppMode;
  novncPort: number;
  isReady: boolean;
}

const AppConfigContext = createContext<AppConfig>({ mode: 'full', novncPort: 6180, isReady: false });

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>({ mode: 'full', novncPort: 6180, isReady: false });

  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((data) => setConfig({ mode: data.mode ?? 'full', novncPort: data.novncPort ?? 6180, isReady: true }))
      .catch(() => setConfig({ mode: 'full', novncPort: 6180, isReady: true }));
  }, []);

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
