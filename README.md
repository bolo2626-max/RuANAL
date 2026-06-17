# RuANAL Dashboard MVP

Интерактивный браузерный MVP-дашборд для мониторинга записей из MySQL-таблицы `content_items_ru` без GPT/AI-анализа.

## Стек

- Backend: FastAPI
- Database: MySQL
- Frontend: React + Vite
- UI: простой responsive layout

## Структура

```text
backend/   FastAPI API для чтения источников, материалов и похожих публикаций
frontend/  React-приложение с двухколоночным дашбордом
```

## Требования

- Python 3.11+
- Node.js 20+
- MySQL с таблицей `content_items_ru`

## Настройка backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Отредактируйте `backend/.env`:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=ruanal
CORS_ORIGINS=http://localhost:5173
```

Запуск API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API будет доступен на `http://localhost:8000`, Swagger UI — на `http://localhost:8000/docs`.

## Настройка frontend

```bash
cd frontend
npm install
cp .env.example .env
```

При необходимости отредактируйте `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Запуск frontend:

```bash
npm run dev
```

Откройте `http://localhost:5173`.

## API

### `GET /api/sources`

Возвращает список источников:

- `source_type`
- `source_name`
- `count`

### `GET /api/items`

Параметры:

- `source_name` — optional
- `source_type` — optional
- `limit` — default `50`
- `offset` — default `0`

Сортировка: `published_at DESC, id DESC`.

### `GET /api/items/{id}`

Возвращает полную запись материала.

### `GET /api/items/{id}/similar`

Возвращает похожие материалы:

1. другие записи с тем же `grouped_id`, если он есть;
2. иначе записи с тем же `content_hash`, если он есть;
3. иначе последние материалы из того же `source_name`.

## Примечания MVP

- GPT/OpenAI-анализ намеренно не используется.
- Просмотр оригинальной публикации выполняется через `iframe` по полю `url`.
- Если ссылка отсутствует или iframe не загрузился, показывается `title` и `text` из базы.
