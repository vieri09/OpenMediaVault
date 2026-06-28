import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { AlbumSortKey, SortOrder } from '../types.ts';
import { AlbumGrid } from '../components/Grids.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { plural } from '../lib/format.ts';

export default function Albums() {
  const [sort, setSort] = useState<AlbumSortKey>('recently_added');
  const [order, setOrder] = useState<SortOrder>('desc');
  const key = `/api/albums?sort=${sort}&order=${order}&limit=200`;
  const { data, error } = useSWR(key, () => api.albums({ sort, order, limit: 200 }));

  return (
    <div className="content">
      <PageHeader
        title="Albums"
        subtitle={data ? plural(data.total, 'album') : 'Loading…'}
      >
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as AlbumSortKey)}>
          <option value="recently_added">Recently added</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="year">Year</option>
        </select>
        <select className="select" value={order} onChange={(e) => setOrder(e.target.value as SortOrder)}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </PageHeader>

      {error ? <div className="error">Could not load albums.</div> : !data ? <Loading /> : <AlbumGrid albums={data.items} />}
    </div>
  );
}
