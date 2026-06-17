import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const ITEMS_PAGE_SIZE = 50;

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

function formatDate(value) {
  if (!value) return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function isTelegramUrl(value) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 't.me' || hostname.endsWith('.t.me') || hostname === 'telegram.me' || hostname.endsWith('.telegram.me');
  } catch {
    return value.toLowerCase().includes('t.me/');
  }
}

function SourceFilter({ sources, selectedSource, selectedType, onChange }) {
  const sourceTypes = useMemo(() => [...new Set(sources.map((source) => source.source_type).filter(Boolean))], [sources]);
  const sourceNames = useMemo(
    () => sources.filter((source) => !selectedType || source.source_type === selectedType),
    [sources, selectedType],
  );

  return (
    <section className="filter-panel">
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
    </section>
  );
}

function NewsCard({ item, active, onClick }) {
  return (
    <button className={`news-card ${active ? 'active' : ''}`} onClick={() => onClick(item.id)}>
      <div className="news-meta"><span>{item.source_name || 'Источник не указан'}</span><span>{item.source_type || 'type —'}</span></div>
      <h3>{item.title || 'Без заголовка'}</h3>
      <time>{formatDate(item.published_at)}</time>
      <p>{item.text_preview || 'Нет превью текста'}</p>
    </button>
  );
}

function NewsGrid({ items, activeItemId, onSelect }) {
  return <div className="news-grid">{items.map((item) => <NewsCard key={item.id} item={item} active={item.id === activeItemId} onClick={onSelect} />)}</div>;
}

function PublicationViewer({ item }) {
  const [iframeFailed, setIframeFailed] = useState(false);
  const telegramUrl = isTelegramUrl(item?.url);

  useEffect(() => setIframeFailed(false), [item?.id]);

  if (!item) return <div className="empty-state">Выберите публикацию слева.</div>;

  const showFallback = !item.url || telegramUrl || iframeFailed;
  const fallbackReason = telegramUrl
    ? 'Telegram не разрешает открывать эту публикацию внутри iframe. Ниже показан текст из базы данных.'
    : 'Оригинал не удалось открыть во встроенном просмотре. Ниже показан текст из базы данных.';

  return (
    <article className="publication">
      <header>
        <h1>{item.title || 'Без заголовка'}</h1>
        <div className="publication-meta">{item.source_name} · {item.source_type} · {formatDate(item.published_at)}</div>
        {item.url && <a href={item.url} target="_blank" rel="noreferrer">Открыть оригинал</a>}
      </header>
      {!showFallback && <iframe title={item.title || `publication-${item.id}`} src={item.url} onError={() => setIframeFailed(true)} />}
      {showFallback && (
        <div className="fallback-content">
          {item.url && <p className="fallback-note">{fallbackReason}</p>}
          <h2>{item.title || 'Без заголовка'}</h2>
          <p>{item.text || 'Текст публикации отсутствует.'}</p>
        </div>
      )}
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
            <strong>{item.title || 'Без заголовка'}</strong>
            <span>{item.source_name} · {formatDate(item.published_at)}</span>
            <p>{item.text_preview || 'Нет превью текста'}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [items, setItems] = useState([]);
  const [activeItemId, setActiveItemId] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [similarItems, setSimilarItems] = useState([]);
  const [itemsOffset, setItemsOffset] = useState(0);
  const [hasMoreItems, setHasMoreItems] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { apiGet('/api/sources').then(setSources).catch((err) => setError(err.message)); }, []);

  function buildItemsPath(offset) {
    const params = new URLSearchParams({ limit: String(ITEMS_PAGE_SIZE), offset: String(offset) });
    if (selectedSource) params.set('source_name', selectedSource);
    if (selectedType) params.set('source_type', selectedType);
    return `/api/items?${params}`;
  }

  function loadItems(offset, append = false) {
    setItemsLoading(true);
    setError(null);
    apiGet(buildItemsPath(offset))
      .then((data) => {
        setItems((current) => (append ? [...current, ...data] : data));
        setItemsOffset(offset + data.length);
        setHasMoreItems(data.length === ITEMS_PAGE_SIZE);
        if (!append) setActiveItemId(data[0]?.id || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setItemsLoading(false));
  }

  useEffect(() => {
    setActiveItem(null);
    setSimilarItems([]);
    loadItems(0, false);
  }, [selectedSource, selectedType]);

  useEffect(() => {
    if (!activeItemId) return;
    setDetailLoading(true);
    setError(null);
    Promise.all([apiGet(`/api/items/${activeItemId}`), apiGet(`/api/items/${activeItemId}/similar`)])
      .then(([item, similar]) => {
        setActiveItem(item);
        setSimilarItems(similar);
        setItems((current) => current.some((entry) => entry.id === item.id) ? current : [{ ...item, text_preview: item.text?.slice(0, 300) }, ...current]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setDetailLoading(false));
  }, [activeItemId]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><h1>RuANAL</h1><span>Media reader MVP</span></div>
        <SourceFilter sources={sources} selectedSource={selectedSource} selectedType={selectedType} onChange={({ sourceType, sourceName }) => { setSelectedType(sourceType); setSelectedSource(sourceName); }} />
        {(itemsLoading || detailLoading) && <div className="status">Загрузка…</div>}
        {error && <div className="error">{error}</div>}
        <NewsGrid items={items} activeItemId={activeItemId} onSelect={setActiveItemId} />
        {hasMoreItems && <button className="load-more" disabled={itemsLoading} onClick={() => loadItems(itemsOffset, true)}>{itemsLoading ? 'Загрузка…' : 'Загрузить ещё'}</button>}
      </aside>
      <section className="content-pane">
        <PublicationViewer item={activeItem} />
        <SimilarItems items={similarItems} loading={detailLoading} onSelect={setActiveItemId} />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
