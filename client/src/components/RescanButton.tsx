import { RefreshCw } from 'lucide-react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { ScanStatus } from '../types.ts';

/** Sidebar control that triggers a library rescan and shows live progress. */
export default function RescanButton() {
  const { data: status, mutate } = useSWR<ScanStatus>('/api/scan/status', api.scanStatus, {
    refreshInterval: (latest) => (latest?.scanning ? 800 : 0),
  });

  const scanning = status?.scanning ?? false;
  const progress =
    status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;

  const handleRescan = async (): Promise<void> => {
    await api.rescan();
    await mutate();
  };

  return (
    <button className="nav-link" onClick={handleRescan} disabled={scanning} title="Rescan music folder">
      <RefreshCw size={18} className={scanning ? 'spin' : ''} style={scanning ? { animation: 'spin 1s linear infinite' } : undefined} />
      {scanning ? `Scanning… ${progress}%` : 'Rescan Library'}
    </button>
  );
}
