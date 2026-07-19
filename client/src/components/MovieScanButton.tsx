import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import useSWR, { mutate as mutateCache } from 'swr';
import { api } from '../api.ts';
import type { ScanStatus } from '../types.ts';

export default function MovieScanButton() {
  const wasScanning = useRef(false);
  const { data: status, mutate } = useSWR<ScanStatus>(
    '/api/movies/scan/status',
    api.movieScanStatus,
    { refreshInterval: (latest) => (latest?.scanning ? 800 : 0) },
  );
  const scanning = status?.scanning ?? false;
  const progress =
    status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;

  useEffect(() => {
    if (wasScanning.current && !scanning) {
      void mutateCache(
        (key) =>
          (typeof key === 'string' && key.startsWith('/api/movies')) ||
          (Array.isArray(key) && key[0] === '/api/movies'),
      );
    }
    wasScanning.current = scanning;
  }, [scanning]);

  const scan = async (): Promise<void> => {
    await api.rescanMovies();
    await mutate();
  };

  return (
    <button className="nav-link" disabled={scanning} onClick={scan}>
      <RefreshCw size={15} className={scanning ? 'spin' : ''} />
      {scanning ? `Scanning ${progress}%` : 'Scan movies'}
    </button>
  );
}
