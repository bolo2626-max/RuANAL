import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const ITEMS_PAGE_SIZE = 30;
const IFRAME_LOAD_TIMEOUT_MS = 12000;
const IFRAME_BLOCKED_DOMAINS = ['t.me', 'telegram.me', 'epp.genproc.gov.ru'];

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

function formatDate(value) {
  if (!value) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function getUrlHostname(value) {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isDomainMatch(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isTelegramUrl(value) {
  const hostname = getUrlHostname(value);
  if (hostname) return isDomainMatch(hostname, 't.me') || isDomainMatch(hostname, 'telegram.me');
  return String(value || '').toLowerCase().includes('t.me/');
}

function isIframeBlockedUrl(value) {
  const hostname = getUrlHostname(value);
  if (!hostname) return false;
  return IFRAME_BLOCKED_DOMAINS.some((domain) => isDomainMatch(hostname, domain));
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDisplayTitle(item) {
  const title = compactText(item?.title);
  if (title && title !== 'Без заголовка') return title;

  const sourceText = compactText(item?.text || item?.text_preview);
  if (!sourceText) return 'Без заголовка';

  return sourceText.length > 80 ? `${sourceText.slice(0, 80)}...` : sourceText;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv']);

function buildMediaUrl(media) {
  if (!media || typeof media !== 'object') return null;
  const remoteUrl = typeof media.url === 'string' ? media.url.trim() : '';
  if (/^https?:\/\//i.test(remoteUrl)) return remoteUrl;
  const path = compactText(media.local_path || remoteUrl || media.src || media.path || media.href || media.file);
  if (!path) return null;
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

function detectMediaType(media, url) {
  const path = String(url || '').split(/[?#]/)[0];
  const extension = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
  if (IMAGE_EXTENSIONS.has(extension) || String(url || '').startsWith('data:image/')) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';

  const declaredType = compactText(media?.type || media?.media_type || media?.mime_type || media?.mime || media?.kind).toLowerCase();
  if (declaredType === 'image' || declaredType.includes('image') || declaredType.includes('photo')) return 'image';
  if (declaredType === 'video' || declaredType.includes('video')) return 'video';
  return 'document';
}

function normalizeMedia(mediaJson) {
  let value = mediaJson;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = [{ url: value }]; }
  }

  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const seen = new Set();
  return entries.flatMap((entry) => {
    const media = typeof entry === 'string' ? { url: entry } : entry;
    const url = buildMediaUrl(media);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, type: detectMediaType(media, url) }];
  });
}

function MediaBlock({ item }) {
  const mediaItems = normalizeMedia(item?.media_json);
  const mediaCount = Number(item?.media_count || 0);

  if (mediaItems.length > 0) {
    return (
      <section className={`media-gallery ${mediaItems.length > 1 ? 'multiple' : 'single'}`} aria-label="Медиа публикации">
        {mediaItems.map((media, index) => {
          if (media.type === 'image') {
            return <a key={media.url} href={media.url} target="_blank" rel="noreferrer" className="media-tile"><img src={media.url} alt={`Медиа ${index + 1}`} loading="lazy" /></a>;
          }
          if (media.type === 'video') {
            return <video key={media.url} className="media-video" controls preload="metadata"><source src={media.url} /></video>;
          }
          return <a key={media.url} className="media-document" href={media.url} target="_blank" rel="noreferrer">Открыть медиа</a>;
        })}
      </section>
    );
  }

  if (mediaCount > 0) {
    return <div className="media-count-note">Медиа: {mediaCount}</div>;
  }

  return null;
}

function SourceFilter({ sources, selectedSource, selectedType, dateFrom, dateTo, searchQuery, onChange, onDateChange, onSearchChange, onSearchClear }) {
  const sourceTypes = useMemo(() => [...new Set(sources.map((source) => source.source_type).filter(Boolean))], [sources]);
  const sourceNames = useMemo(
    () => sources.filter((source) => !selectedType || source.source_type === selectedType),
    [sources, selectedType],
  );

  return (
    <section className="filter-panel">
      <label>
        Поиск
        <div className="search-filter-row">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Поиск по материалам..."
            aria-label="Поиск по материалам"
          />
          {searchQuery && (
            <button type="button" onClick={onSearchClear} aria-label="Очистить поиск">✕</button>
          )}
        </div>
      </label>
      <label>
        Тип источника
        <select value={selectedType || ''} onChange={(event) => onChange({ sourceType: event.target.value || null, sourceName: null })}>
          <option value="">Все типы</option>
          {sourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label>
        Источник
        <select value={selectedSource || ''} onChange={(event) => onChange({ sourceType: selectedType, sourceName: event.target.value || null })}>
          <option value="">Все источники</option>
          {sourceNames.map((source) => <option key={`${source.source_type}-${source.source_name}`} value={source.source_name}>{source.source_name} ({source.count})</option>)}
        </select>
      </label>
      <div className="date-filter-row">
        <label>
          Дата с:
          <input type="date" value={dateFrom} onChange={(event) => onDateChange({ dateFrom: event.target.value, dateTo })} />
        </label>
        <label>
          Дата по:
          <input type="date" value={dateTo} onChange={(event) => onDateChange({ dateFrom, dateTo: event.target.value })} />
        </label>
      </div>
    </section>
  );
}

function NewsCard({ item, active, onClick }) {
  const displayTitle = getDisplayTitle(item);
  return (
    <button className={`news-card ${active ? 'active' : ''}`} onClick={() => onClick(item.id)}>
      <div className="news-meta"><span>{item.source_name || 'Источник не указан'}</span><span>{item.source_type || 'type —'}</span></div>
      <h3>{displayTitle}</h3>
      <time>{formatDate(item.published_at)}</time>
      {Number(item.media_count || 0) > 0 && <span className="media-badge">Медиа: {item.media_count}</span>}
      <p>{item.text_preview || 'Нет превью текста'}</p>
    </button>
  );
}

function NewsGrid({ items, activeItemId, onSelect }) {
  return <div className="news-grid">{items.map((item) => <NewsCard key={item.id} item={item} active={item.id === activeItemId} onClick={onSelect} />)}</div>;
}

function PublicationFallback({ item, fallbackReason }) {
  const displayTitle = getDisplayTitle(item);

  return (
    <div className="fallback-content">
      {fallbackReason && <p className="fallback-note">{fallbackReason}</p>}
      <div className="fallback-card-header">
        <h2>{displayTitle}</h2>
        <div className="publication-meta">{item.source_name || 'Источник не указан'} · {item.source_type || 'type —'} · {formatDate(item.published_at)}</div>
      </div>
      <MediaBlock item={item} />
      <p className="fallback-text">{item.text || 'Текст публикации отсутствует.'}</p>
      {item.url && <a className="fallback-original-link" href={item.url} target="_blank" rel="noreferrer">Открыть оригинал</a>}
    </div>
  );
}

function PublicationViewer({ item }) {
  const [iframeFailed, setIframeFailed] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const telegramUrl = isTelegramUrl(item?.url);
  const iframeBlockedUrl = isIframeBlockedUrl(item?.url);

  useEffect(() => {
    setIframeFailed(false);
    setIframeLoaded(false);
  }, [item?.id]);

  useEffect(() => {
    if (!item?.url || iframeBlockedUrl || iframeLoaded || iframeFailed) return undefined;
    const timeoutId = window.setTimeout(() => setIframeFailed(true), IFRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [item?.id, item?.url, iframeBlockedUrl, iframeLoaded, iframeFailed]);

  if (!item) return <div className="empty-state">Выберите публикацию слева.</div>;

  const showFallback = !item.url || iframeBlockedUrl || iframeFailed;
  const displayTitle = getDisplayTitle(item);
  const fallbackReason = telegramUrl
    ? null
    : 'Оригинал не удалось открыть во встроенном просмотре. Ниже показан текст из базы данных.';

  if (showFallback) {
    return (
      <article className="publication">
        <PublicationFallback item={item} fallbackReason={fallbackReason} />
      </article>
    );
  }

  return (
    <article className="publication">
      <header>
        <h1>{displayTitle}</h1>
        <div className="publication-meta">{item.source_name} · {item.source_type} · {formatDate(item.published_at)}</div>
        {item.url && <a href={item.url} target="_blank" rel="noreferrer">Открыть оригинал</a>}
      </header>
      <MediaBlock item={item} />
      <iframe
        title={displayTitle || `publication-${item.id}`}
        src={item.url}
        onLoad={() => setIframeLoaded(true)}
        onError={() => setIframeFailed(true)}
      />
    </article>
  );
}

function SimilarItems({ items, loading, onSelect }) {
  return (
    <section className="similar">
      <h2>Похожие материалы</h2>
      {loading && <p className="muted">Загрузка похожих материалов…</p>}
      {!loading && items.length === 0 && <p className="muted">Похожие материалы не найдены.</p>}
      <div className="similar-list">
        {items.map((item) => (
          <button key={item.id} className="similar-card" onClick={() => onSelect(item.id)}>
            <strong>{getDisplayTitle(item)}</strong>
            <span>{item.source_name} · {formatDate(item.published_at)}</span>
            {typeof item.relevance === 'number' && <span className="relevance-badge">Релевантность: {item.relevance.toFixed(2)}</span>}
            {Number(item.media_count || 0) > 0 && <span className="media-badge">Медиа: {item.media_count}</span>}
            <p>{item.text_preview || 'Нет превью текста'}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function TagCloud({ title, tags, activeKeyword, onSelectTag }) {
  const counts = tags.map((entry) => entry.count);
  const minCount = Math.min(...counts, 0);
  const maxCount = Math.max(...counts, 0);

  function getTagSize(count) {
    if (maxCount <= minCount) return 1;
    return 0.9 + ((count - minCount) / (maxCount - minCount)) * 0.9;
  }

  return (
    <section className="keyword-section">
      <h2>{title}</h2>
      {tags.length === 0 && <p className="muted">Нет данных.</p>}
      <div className="tag-cloud">
        {tags.map((entry) => (
          <button
            key={`${entry.type}-${entry.tag}`}
            type="button"
            className={`tag-cloud-item ${entry.type === 'entity' ? 'entity' : 'word'} ${activeKeyword === entry.tag ? 'active' : ''}`}
            style={{ fontSize: `${getTagSize(entry.count)}rem` }}
            onClick={() => onSelectTag(entry.tag)}
            title={entry.type === 'entity' ? 'Потенциальная сущность' : 'Частотное слово'}
          >
            <span>{entry.tag}</span> <small>{entry.count}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function AnalyticsPane({ dailyTags, fiveDaysTags, activeKeyword, onSelectTag }) {
  return (
    <aside className="analytics-pane">
      <TagCloud title="Облако тегов за день" tags={dailyTags} activeKeyword={activeKeyword} onSelectTag={onSelectTag} />
      <TagCloud title="Облако тегов за 5 дней" tags={fiveDaysTags} activeKeyword={activeKeyword} onSelectTag={onSelectTag} />
    </aside>
  );
}

function Pagination({ page, hasNextPage, loading, onPageChange }) {
  return (
    <nav className="pagination" aria-label="Пагинация новостей">
      <button disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Назад</button>
      <span>Страница {page}</span>
      <button disabled={loading || !hasNextPage} onClick={() => onPageChange(page + 1)}>Вперёд</button>
    </nav>
  );
}

function App() {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [items, setItems] = useState([]);
  const [activeItemId, setActiveItemId] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [similarItems, setSimilarItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [dailyTags, setDailyTags] = useState([]);
  const [fiveDaysTags, setFiveDaysTags] = useState([]);
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const contentPaneRef = useRef(null);
  const newsScrollRef = useRef(null);
  const itemsRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [loadedPage, setLoadedPage] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { apiGet('/api/sources').then(setSources).catch((err) => setError(err.message)); }, []);

  const itemsFilterKey = useMemo(() => JSON.stringify({
    selectedSource,
    selectedType,
    dateFrom,
    dateTo,
    activeKeyword,
    searchQuery: searchQuery.trim(),
  }), [selectedSource, selectedType, dateFrom, dateTo, activeKeyword, searchQuery]);

  const buildItemsPath = useCallback((nextPage) => {
    const params = new URLSearchParams({ limit: String(ITEMS_PAGE_SIZE), offset: String((nextPage - 1) * ITEMS_PAGE_SIZE) });
    if (selectedSource) params.set('source_name', selectedSource);
    if (selectedType) params.set('source_type', selectedType);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const cleanSearchQuery = searchQuery.trim();
    const effectiveKeyword = cleanSearchQuery || activeKeyword;
    if (effectiveKeyword) params.set('keyword', effectiveKeyword);
    return `/api/items?${params}`;
  }, [selectedSource, selectedType, dateFrom, dateTo, searchQuery, activeKeyword]);

  const loadItems = useCallback((nextPage) => {
    const requestId = itemsRequestIdRef.current + 1;
    itemsRequestIdRef.current = requestId;
    setItemsLoading(true);
    setError(null);
    console.time(`loadItems page=${nextPage}`);
    apiGet(buildItemsPath(nextPage))
      .then((data) => {
        if (requestId !== itemsRequestIdRef.current) return;
        setItems(data);
        setHasNextPage(data.length === ITEMS_PAGE_SIZE);
        setActiveItemId(data[0]?.id || null);
        setLoadedPage(nextPage);
      })
      .catch((err) => {
        if (requestId === itemsRequestIdRef.current) setError(err.message);
      })
      .finally(() => {
        console.timeEnd(`loadItems page=${nextPage}`);
        if (requestId === itemsRequestIdRef.current) setItemsLoading(false);
      });
  }, [buildItemsPath]);

  useEffect(() => {
    if (page !== 1) {
      setPage(1);
      return;
    }
    setActiveItem(null);
    setSimilarItems([]);
    loadItems(1);
  }, [itemsFilterKey, loadItems]);

  useEffect(() => {
    if (page === 1) return;
    setActiveItem(null);
    setSimilarItems([]);
    loadItems(page);
  }, [page, loadItems]);

  useEffect(() => {
    if (loadedPage !== page) return;
    const frameId = window.requestAnimationFrame(() => {
      newsScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [loadedPage, page]);

  useEffect(() => {
    console.time('loadTags');
    Promise.all([apiGet('/api/tags/daily'), apiGet('/api/tags/five-days')])
      .then(([daily, fiveDays]) => {
        setDailyTags(daily);
        setFiveDaysTags(fiveDays);
      })
      .catch((err) => setError(err.message))
      .finally(() => console.timeEnd('loadTags'));
  }, []);

  useEffect(() => {
    if (!activeItemId) return;
    contentPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    contentPaneRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);
    setError(null);
    console.time(`loadItemDetail id=${activeItemId}`);
    Promise.all([apiGet(`/api/items/${activeItemId}`), apiGet(`/api/items/${activeItemId}/similar`)])
      .then(([item, similar]) => {
        if (requestId !== detailRequestIdRef.current) return;
        setActiveItem(item);
        setSimilarItems(similar);
      })
      .catch((err) => {
        if (requestId === detailRequestIdRef.current) setError(err.message);
      })
      .finally(() => {
        console.timeEnd(`loadItemDetail id=${activeItemId}`);
        if (requestId === detailRequestIdRef.current) setDetailLoading(false);
      });
  }, [activeItemId]);

  function handleSearchChange(nextSearchQuery) {
    setSearchQuery(nextSearchQuery);
    if (nextSearchQuery.trim()) setActiveKeyword(null);
    setPage(1);
  }

  function handleSearchClear() {
    setSearchQuery('');
    setPage(1);
  }

  return (
    <main className="dashboard">
      <header className="top-toolbar">
        <div className="brand"><h1>RuANAL</h1><span>Media reader MVP</span></div>
        <SourceFilter
          sources={sources}
          selectedSource={selectedSource}
          selectedType={selectedType}
          dateFrom={dateFrom}
          dateTo={dateTo}
          searchQuery={searchQuery}
          onChange={({ sourceType, sourceName }) => { setSelectedType(sourceType); setSelectedSource(sourceName); setPage(1); }}
          onDateChange={({ dateFrom: nextDateFrom, dateTo: nextDateTo }) => { setDateFrom(nextDateFrom); setDateTo(nextDateTo); setPage(1); }}
          onSearchChange={handleSearchChange}
          onSearchClear={handleSearchClear}
        />
        {activeKeyword && !searchQuery.trim() && <div className="active-tag-filter">Тег: {activeKeyword}<button type="button" onClick={() => { setActiveKeyword(null); setPage(1); }} aria-label="Очистить фильтр по тегу">✕</button></div>}
      </header>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-status">
          {(itemsLoading || detailLoading) && <div className="status">Загрузка…</div>}
          {error && <div className="error">{error}</div>}
        </div>
        <div className="news-scroll" ref={newsScrollRef}><NewsGrid items={items} activeItemId={activeItemId} onSelect={setActiveItemId} /></div>
        <Pagination page={page} hasNextPage={hasNextPage} loading={itemsLoading} onPageChange={setPage} />
      </aside>
      <section className="content-pane" ref={contentPaneRef}>
        <PublicationViewer item={activeItem} />
        <SimilarItems items={similarItems} loading={detailLoading} onSelect={setActiveItemId} />
      </section>
      <AnalyticsPane dailyTags={dailyTags} fiveDaysTags={fiveDaysTags} activeKeyword={searchQuery.trim() ? null : activeKeyword} onSelectTag={(tag) => { setSearchQuery(''); setActiveKeyword(tag); setPage(1); }} />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
