import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { Album, AlbumSortKey, SortOrder } from '../types.ts';
import { AlbumGrid } from '../components/Grids.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { plural } from '../lib/format.ts';

/** Per-request chunk size when fetching every album. The server caps page size
 *  at 500, so we page through at that ceiling until the whole list is loaded. */
const FETCH_LIMIT = 500;

/** Fetch every album across all pages as a single flat list, so the grid shows
 *  the entire library with no prev/next pagination. */
async function fetchAllAlbums(sort: AlbumSortKey, order: SortOrder): Promise<Album[]> {
  let page = 1;
  let total = Infinity;
  const all: Album[] = [];
  while (all.length < total) {
    const res = await api.albums({ sort, order, limit: FETCH_LIMIT, page });
    if (res.items.length === 0) break; // guard against an empty trailing page
    all.push(...res.items);
    total = res.total;
    page++;
  }
  return all;
}

export default function Albums() {
  const [sort, setSort] = useState<AlbumSortKey>('recently_added');
  const [order, setOrder] = useState<SortOrder>('desc');

  const { data, error } = useSWR(
    ['/api/albums', sort, order] as const,
    ([, s, o]) => fetchAllAlbums(s, o),
  );

  return (
    <div className="content">
      <PageHeader title="Albums" subtitle={data ? plural(data.length, 'album') : 'Loading…'}>
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

      {error ? <div className="error">Could not load albums.</div> : !data ? <Loading /> : <AlbumGrid albums={data} />}
    </div>
  );
}
