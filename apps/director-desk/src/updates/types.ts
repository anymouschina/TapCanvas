export interface UpdateState {
    currentVersion: string; mode: 'installed' | 'portable' | 'development' | 'unsupported';
    phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
    version: string; notes: string; percent: number; message: string; checkedAt: string;
    source: '' | 'website' | 'github'; canDownload: boolean;
    config: { url: string; automatic: boolean; source: 'auto' | 'website' | 'github' };
}
