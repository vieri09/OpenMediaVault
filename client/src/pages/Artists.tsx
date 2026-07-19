import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { SortOrder } from '../types.ts';
import { ArtistGrid } from '../components/Grids.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { plural } from '../lib/format.ts';

export default function Artists() {
  const [order, setOrder] = useState<SortOrder>('asc');
  const [page, setPage] = useState(1);
  const key = `/api/artists?order=${order}&page=${page}&limit=100`;
  const { data, error } = useSWR(key, () => api.artists({ order, page, limit: 100 }));

  return (
    <div className="content">
      <PageHeader title="Artists" subtitle={data ? plural(data.total, 'artist') : 'Loading…'}>
        <select className="select" value={order} onChange={(e) => {
          setOrder(e.target.value as SortOrder);
          setPage(1);
        }}>
          <option value="asc">A → Z</option>
          <option value="desc">Z → A</option>
        </select>
      </PageHeader>
      {error ? (
        <div className="error">Could not load artists.</div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <ArtistGrid artists={data.items} />
          {data.totalPages > 1 && (
            <div className="pagination">
              <button className="btn" disabled={data.page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <span>Page {data.page} of {data.totalPages}</span>
              <button className="btn" disabled={data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
