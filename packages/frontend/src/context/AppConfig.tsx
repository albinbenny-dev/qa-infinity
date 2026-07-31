import React, { createContext, useContext, useEffect, useState } from 'react';

type AppMode = 'full' | 'runner';

interface AppConfig {
  mode: AppMode;
  novncPort: number;
  maxVncSessions: number;
  isReady: boolean;
}

const DEFAULTS = { mode: 'full' as AppMode, novncPort: 6180, maxVncSessions: 6 };

const AppConfigContext = createContext<AppConfig>({ ...DEFAULTS, isReady: false });

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>({ ...DEFAULTS, isReady: false });

  useEffect(() => {
    fetch('/api/app-config')
      .then((r) => r.json())
      .then((data) => setConfig({
        mode: data.mode ?? DEFAULTS.mode,
        novncPort: data.novncPort ?? DEFAULTS.novncPort,
        maxVncSessions: data.maxVncSessions ?? DEFAULTS.maxVncSessions,
        isReady: true,
      }))
      .catch(() => setConfig({ ...DEFAULTS, isReady: true }));
  }, []);

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}
