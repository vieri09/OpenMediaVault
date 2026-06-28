import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { SortOrder } from '../types.ts';
import { ArtistGrid } from '../components/Grids.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { plural } from '../lib/format.ts';

export default function Artists() {
  const [order, setOrder] = useState<SortOrder>('asc');
  const key = `/api/artists?order=${order}&limit=500`;
  const { data, error } = useSWR(key, () => api.artists({ order, limit: 500 }));

  return (
    <div className="content">
      <PageHeader title="Artists" subtitle={data ? plural(data.total, 'artist') : 'Loading…'}>
        <select className="select" value={order} onChange={(e) => setOrder(e.target.value as SortOrder)}>
          <option value="asc">A → Z</option>
          <option value="desc">Z → A</option>
        </select>
      </PageHeader>
      {error ? <div className="error">Could not load artists.</div> : !data ? <Loading /> : <ArtistGrid artists={data.items} />}
    </div>
  );
}
