// ABOUTME: Shared cache configuration and status interfaces
// ABOUTME: Used by the server (index.ts) and the cache tool module (cacheTools.ts)

export interface ICacheConfig {
  enabled: boolean;
  dbPath: string;
  maxAgeSeconds: number;
  maxProbeFailures: number;
  autoSync: boolean;
  fullSyncIntervalHours: number;
}

export interface ICacheStatus {
  enabled: boolean;
  ready: boolean;
  dbPath: string;
  totalForms: number;
  activeForms: number;
  lastSync: Date | null;
  config: ICacheConfig;
}
