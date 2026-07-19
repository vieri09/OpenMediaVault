import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../api.ts';
import type { SortOrder, TrackSortKey } from '../types.ts';
import { TrackList } from '../components/TrackList.tsx';
import { PageHeader, Loading } from '../components/common.tsx';
import { plural } from '../lib/format.ts';

const PAGE_SIZE = 100;

export default function Songs() {
  const [searchParams] = useSearchParams();
  const genre = searchParams.get('genre') ?? undefined;
  const [sort, setSort] = useState<TrackSortKey>('title');
  const [order, setOrder] = useState<SortOrder>('asc');
  const [page, setPage] = useState(1);
  const key = `/api/tracks?sort=${sort}&order=${order}&page=${page}&limit=${PAGE_SIZE}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`;
  const { data, error } = useSWR(key, () => api.tracks({ sort, order, page, limit: PAGE_SIZE, genre }));

  useEffect(() => setPage(1), [genre]);

  const title = genre ? `Genre: ${genre}` : 'Songs';

  return (
    <div className="content">
      <PageHeader title={title} subtitle={data ? plural(data.total, 'song') : 'Loading…'}>
        <select className="select" value={sort} onChange={(e) => {
          setSort(e.target.value as TrackSortKey);
          setPage(1);
        }}>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
          <option value="duration">Duration</option>
          <option value="date_added">Date added</option>
        </select>
        <select className="select" value={order} onChange={(e) => {
          setOrder(e.target.value as SortOrder);
          setPage(1);
        }}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </PageHeader>
      {error ? (
        <div className="error">Could not load songs.</div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <TrackList
            tracks={data.items}
            showAlbum
            indexOffset={(data.page - 1) * data.limit}
            emptyMessage="No songs in your library yet."
          />
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
