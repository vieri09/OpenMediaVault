import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { book, bookPageUrl, saveBookProgress } from '../api.ts';
import type { Book } from '../types.ts';

const ZOOM_MIN = 40;
const ZOOM_MAX = 500;

/** How many pages ahead of the current page to preload. */
const PRELOAD_AHEAD = 5;
/** How many pages behind the current page to keep loaded. */
const PRELOAD_BEHIND = 2;
/** Maximum number of blob URLs to keep in memory at once. */
const MAX_LOADED = 30;

export default function BookReader() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [bookMeta, setBookMeta] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fitToWidth, setFitToWidth] = useState(true);

  // Mutable refs so the scroll observer always sees fresh values.
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageSrcsRef = useRef<Record<number, string>>({});
  const loadingRef = useRef<Set<number>>(new Set());
  const loadedCountRef = useRef(0);
  // Dummy state bumped to trigger re-renders when a page finishes loading.
  const [, setLoadedTick] = useState(0);

  const totalPages = bookMeta?.pageCount ?? 0;

  // ── book metadata ──────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    book(id)
      .then(setBookMeta)
      .catch(() => setError('Book not found.'));
  }, [id]);

  // ── scroll → current page ─────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container || totalPages === 0) return;

    const viewMid = container.scrollTop + container.clientHeight / 2;
    let bestPage = 1;
    let bestDist = Infinity;

    for (const [pageNum, el] of pageElsRef.current) {
      const rect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const pageTop = rect.top - containerRect.top + container.scrollTop;
      const pageMid = pageTop + rect.height / 2;
      const dist = Math.abs(pageMid - viewMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = pageNum;
      }
    }

    setCurrentPage(bestPage);
  }, [totalPages]);

  // ── lazy-load pages as currentPage changes ────────────────────────
  useEffect(() => {
    if (!id || totalPages === 0) return;

    const desiredStart = Math.max(1, currentPage - PRELOAD_BEHIND);
    const desiredEnd = Math.min(totalPages, currentPage + PRELOAD_AHEAD);

    // Load pages that should be visible but aren't loaded yet.
    for (let page = desiredStart; page <= desiredEnd; page++) {
      if (pageSrcsRef.current[page] || loadingRef.current.has(page)) continue;

      loadingRef.current.add(page);

      fetch(bookPageUrl(id, page))
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          const src = URL.createObjectURL(blob);
          pageSrcsRef.current = { ...pageSrcsRef.current, [page]: src };
          loadedCountRef.current++;
          setLoadedTick((t) => t + 1);
        })
        .catch(() => {
          // Page failed to load — skip it silently.
        })
        .finally(() => {
          loadingRef.current.delete(page);
        });
    }

    // Unload pages that are far from the current viewport to keep
    // memory usage bounded.
    const loaded = Object.keys(pageSrcsRef.current).map(Number);
    if (loaded.length > MAX_LOADED) {
      const desiredSet = new Set<number>();
      for (let p = desiredStart; p <= desiredEnd; p++) desiredSet.add(p);

      const toEvict = loaded
        .filter((p) => !desiredSet.has(p))
        .sort((a, b) => {
          // Evict pages furthest from current position first.
          return Math.abs(b - currentPage) - Math.abs(a - currentPage);
        })
        .slice(0, loaded.length - MAX_LOADED + PRELOAD_AHEAD);

      if (toEvict.length > 0) {
        const next = { ...pageSrcsRef.current };
        for (const p of toEvict) {
          URL.revokeObjectURL(next[p]);
          delete next[p];
        }
        pageSrcsRef.current = next;
        setLoadedTick((t) => t + 1);
      }
    }
  }, [currentPage, id, totalPages]);

  // ── auto-save progress (debounced) ────────────────────────────────
  const lastSavedPage = useRef(0);
  useEffect(() => {
    if (!id || totalPages === 0 || currentPage === lastSavedPage.current) return;
    lastSavedPage.current = currentPage;
    const timer = setTimeout(() => {
      saveBookProgress(id, currentPage).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [currentPage, id, totalPages]);

  // ── save progress on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (id && lastSavedPage.current > 0) {
        saveBookProgress(id, lastSavedPage.current).catch(() => {});
      }
    };
  }, [id]);

  // ── cleanup all blob URLs on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      for (const src of Object.values(pageSrcsRef.current)) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── keyboard shortcuts ────────────────────────────────────────────
  const revealControls = useCallback(() => setControlsVisible(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate(-1);
        return;
      }
      if (error) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(Math.min(totalPages, currentPage + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(Math.max(1, currentPage - 1));
      }
      revealControls();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, totalPages, error, navigate, revealControls]);

  // ── navigation helpers ────────────────────────────────────────────
  const goToPage = (page: number) => {
    const el = pageElsRef.current.get(page);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Page wrapper not in DOM yet — estimate scroll position.
      const container = containerRef.current;
      if (container) {
        const estimatedTop = (page - 1) * (container.scrollWidth * 1.5);
        container.scrollTo({ top: estimatedTop, behavior: 'smooth' });
      }
    }
  };

  const adjustZoom = (delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));
    if (delta !== 0 && fitToWidth) setFitToWidth(false);
  };

  const handleZoomSlider = (value: number) => {
    setZoom(value);
    if (fitToWidth) setFitToWidth(false);
  };

  const toggleFitToWidth = () => {
    setFitToWidth((f) => {
      if (!f) setZoom(100);
      return !f;
    });
  };

  // ── UI controls callbacks ─────────────────────────────────────────
  const toggleControls = useCallback(() => {
    setControlsVisible((v) => !v);
  }, []);

  // ── error state ───────────────────────────────────────────────────
  if (error) {
    return (
      <div className="book-reader">
        <div className="video-error">
          <div>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={() => navigate(-1)}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const scale = zoom / 100;
  const pageSrcs = pageSrcsRef.current;

  return (
    <div
      className={`book-reader${controlsVisible ? ' book-controls-visible' : ''}`}
    >
      {/* Gradient vignette — darkens top/bottom so controls are readable on any page */}
      <div className="book-vignette" />

      {/* Top bar */}
      <div className="book-topbar" onClick={(e) => e.stopPropagation()}>
        <button className="video-back" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="video-title-block">
          <strong>{bookMeta?.title ?? 'Book'}</strong>
          <span>{totalPages > 0 ? `${currentPage} / ${totalPages}` : ''}</span>
        </div>
      </div>

      {/* Page container */}
      <div
        ref={containerRef}
        className="book-pages"
        onScroll={handleScroll}
        onClick={toggleControls}
      >
        {totalPages > 0 &&
          Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
            const src = pageSrcs[pageNum];
            const isLoading = loadingRef.current.has(pageNum);
            return (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) pageElsRef.current.set(pageNum, el);
                  else pageElsRef.current.delete(pageNum);
                }}
                data-page={pageNum}
                className={`book-page-wrapper${!src ? ' book-page-placeholder' : ''}`}
                style={fitToWidth ? undefined : { zoom: scale }}
              >
                {src ? (
                  <img
                    src={src}
                    alt={`Page ${pageNum}`}
                    className="book-page-img"
                    draggable={false}
                  />
                ) : (
                  <div className="book-page-skeleton">
                    {isLoading && <div className="spinner" />}
                    <span className="book-page-skeleton-num">{pageNum}</span>
                  </div>
                )}
                <div className="book-page-num">{pageNum}</div>
              </div>
            );
          })}

        {totalPages === 0 && (
          <div className="empty-state" style={{ paddingTop: '30vh' }}>
            <p>No pages found in this book.</p>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="book-controls" onClick={(e) => e.stopPropagation()}>
        {/* Page slider */}
        <div className="book-timeline">
          <input
            type="range"
            min={1}
            max={Math.max(1, totalPages)}
            value={currentPage}
            onChange={(e) => goToPage(Number(e.target.value))}
            style={
              {
                '--slider-progress': `${((currentPage - 1) / Math.max(1, totalPages - 1)) * 100}%`,
              } as React.CSSProperties
            }
          />
        </div>

        <div className="video-control-row">
          <div className="video-control-group">
            <button
              className="video-control-button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="video-control-button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={20} />
            </button>
            <span className="video-time">
              {currentPage} / {totalPages}
            </span>
          </div>

          <div className="video-control-group">
            <button
              className="video-control-button"
              onClick={() => adjustZoom(-10)}
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              value={zoom}
              onChange={(e) => handleZoomSlider(Number(e.target.value))}
              className="video-volume book-zoom-slider"
              style={
                {
                  width: 80,
                  '--slider-progress': `${((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`,
                } as React.CSSProperties
              }
              aria-label="Zoom level"
            />
            <button
              className="video-control-button"
              onClick={() => adjustZoom(10)}
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
            <button
              className={`video-mode${fitToWidth ? ' active' : ''}`}
              onClick={toggleFitToWidth}
              style={
                fitToWidth
                  ? {
                      background: 'rgba(245, 158, 11, 0.25)',
                      borderColor: '#f59e0b',
                      color: '#f59e0b',
                    }
                  : {}
              }
            >
              Fit
            </button>
            <span className="video-time">{zoom}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
