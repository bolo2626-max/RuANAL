import json
import re
from collections import Counter
from pathlib import Path
from typing import Any
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from .config import get_settings
from .db import get_db
from .schemas import ItemDetail, ItemList, Keyword, SimilarItem, Source, Tag
from fastapi.staticfiles import StaticFiles

settings = get_settings()
app = FastAPI(title="RuANAL Dashboard API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/media_ru",
    StaticFiles(directory="/home/bolo/PROJECTS/PY_PROJECTS/Teleparser/media_ru"),
    name="media_ru"
)

app.mount(
    "/media_ua",
    StaticFiles(directory="/home/bolo/PROJECTS/PY_PROJECTS/Teleparser/media_ua"),
    name="media_ua"
)



RUSSIAN_STOP_WORDS = {
    "а", "без", "более", "больше", "будет", "будто", "бы", "был", "была", "были", "было",
    "быть", "в", "вам", "вас", "вдруг", "ведь", "во", "вот", "впрочем", "все", "всегда",
    "всего", "всех", "всю", "вы", "где", "да", "даже", "два", "для", "до", "другой",
    "его", "ее", "ей", "ему", "если", "есть", "еще", "же", "за", "зачем", "здесь", "и",
    "из", "или", "им", "иногда", "их", "к", "как", "какая", "какой", "когда", "конечно",
    "кто", "куда", "ли", "лучше", "между", "меня", "мне", "много", "может", "можно",
    "мой", "моя", "мы", "на", "над", "надо", "наконец", "нас", "не", "него", "нее", "ней",
    "нельзя", "нет", "ни", "нибудь", "никогда", "ним", "них", "ничего", "но", "ну", "о",
    "об", "один", "он", "она", "они", "оно", "опять", "от", "перед", "по", "под", "после",
    "потом", "потому", "почти", "при", "про", "раз", "разве", "с", "сам", "свое", "свою",
    "себе", "себя", "сейчас", "со", "совсем", "так", "такой", "там", "тебя", "тем", "теперь",
    "то", "тогда", "того", "тоже", "только", "том", "тот", "три", "тут", "ты", "у", "уж",
    "уже", "хоть", "чего", "чей", "чем", "через", "что", "чтоб", "чтобы", "чуть", "эти",
    "этого", "этой", "этом", "этот", "эту", "я", "это", "как", "также", "которые", "который",
}
WORD_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ]+")
ENTITY_RE = re.compile(r"(?<![0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ])(?:[А-ЯЁІЇЄҐ][а-яёіїєґ]{2,}|[А-ЯЁІЇЄҐ]{2,})(?![0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ])")
SENTENCE_START_RE = re.compile(r"(?:^|[.!?…]\s+)([А-ЯЁІЇЄҐ][а-яёіїєґ]+|[А-ЯЁІЇЄҐ]{2,})")

TAG_BLACKLIST = {
    "подписаться", "читать", "подробнее", "канал", "канале", "telegram", "ссылка", "ссылки",
    "сегодня", "завтра", "вчера", "также", "далее", "теперь", "сейчас",
    "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря", "января", "февраля", "марта", "апреля", "мая",
    "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
    "года", "год", "день", "дней", "время", "раз", "уже",
    "сообщил", "сообщила", "сообщили", "сообщает", "сообщают", "заявил", "заявила", "заявили",
    "область", "области", "района", "район", "округ", "округа", "город", "города",
    "жители", "жителей", "человек", "людей", "работы", "работа", "данные", "информация",
    "новый", "новая", "новые", "первый", "первые",
}
SHORT_ENTITY_WHITELIST = {"ООН", "НАТО", "США", "РФ", "ЕС", "ВСУ", "БПЛА", "ПВО", "КНР", "МВД", "ФСБ", "МЧС"}
TAG_STOP_WORDS = RUSSIAN_STOP_WORDS | TAG_BLACKLIST


def _is_allowed_word_tag(word: str) -> bool:
    return len(word) >= 4 and word not in TAG_STOP_WORDS


def _is_sentence_start_blacklisted(text: str, start: int, value: str) -> bool:
    tag_key = value.lower()
    if tag_key not in TAG_STOP_WORDS:
        return False
    return any(match.start(1) == start and match.group(1).lower() == tag_key for match in SENTENCE_START_RE.finditer(text))


def _is_allowed_entity_tag(text: str, match: re.Match[str]) -> bool:
    value = match.group(0)
    key = value.lower()
    if key in TAG_STOP_WORDS:
        return False
    if _is_sentence_start_blacklisted(text, match.start(), value):
        return False
    if value.isupper() and len(value) < 4 and value not in SHORT_ENTITY_WHITELIST:
        return False
    return True


def _parse_json(value: Any) -> Any:
    if value is None or not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _row_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/sources", response_model=list[Source])
def get_sources(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.execute(text("""
        SELECT source_type, source_name, COUNT(*) AS count
        FROM content_items_ru
        GROUP BY source_type, source_name
        ORDER BY source_type ASC, source_name ASC
    """)).fetchall()
    return [_row_dict(row) for row in rows]


ITEM_LIST_COLUMNS = """
        id,
        source_type,
        source_name,
        title,
        LEFT(text, 300) AS text_preview,
        url,
        published_at,
        grouped_id,
        content_type,
        media_count
"""


def _items_filter_clause(keyword_mode: str | None = None) -> str:
    clauses = [
        "(:source_name IS NULL OR source_name = :source_name)",
        "(:source_type IS NULL OR source_type = :source_type)",
        "(:date_from IS NULL OR published_at >= CONCAT(:date_from, ' 00:00:00'))",
        "(:date_to IS NULL OR published_at < DATE_ADD(:date_to, INTERVAL 1 DAY))",
    ]
    if keyword_mode == "fulltext":
        clauses.append("MATCH(title, text) AGAINST(:keyword IN NATURAL LANGUAGE MODE)")
    elif keyword_mode == "like":
        clauses.append("(title LIKE :keyword_like OR text LIKE :keyword_like)")
    return " AND ".join(clauses)


def _fetch_items(db: Session, params: dict[str, Any], keyword_mode: str | None = None) -> list[Any]:
    relevance_select = ""
    relevance_order = ""
    if keyword_mode == "fulltext":
        relevance_select = ", MATCH(title, text) AGAINST(:keyword IN NATURAL LANGUAGE MODE) AS relevance"
        relevance_order = "relevance DESC, "
    return db.execute(text(f"""
        SELECT
        {ITEM_LIST_COLUMNS.rstrip()}
        {relevance_select}
        FROM content_items_ru
        WHERE {_items_filter_clause(keyword_mode)}
        ORDER BY {relevance_order}published_at DESC, id DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()


@app.get("/api/items", response_model=list[ItemList])
def get_items(
    source_name: str | None = None,
    source_type: str | None = None,
    date_from: str | None = Query(default=None, description="Start date in YYYY-MM-DD format"),
    date_to: str | None = Query(default=None, description="End date in YYYY-MM-DD format"),
    keyword: str | None = Query(default=None, description="Keyword or tag for full-text filtering"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    clean_keyword = keyword.strip() if keyword else None
    params = {
        "source_name": source_name,
        "source_type": source_type,
        "date_from": date_from,
        "date_to": date_to,
        "keyword": clean_keyword,
        "keyword_like": f"%{clean_keyword}%" if clean_keyword else None,
        "limit": limit,
        "offset": offset,
    }
    if clean_keyword:
        rows = _fetch_items(db, params, "fulltext")
        if not rows:
            rows = _fetch_items(db, params, "like")
    else:
        rows = _fetch_items(db, params)
    return [_row_dict(row) for row in rows]


@app.get("/api/items/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.execute(text("""
        SELECT
            id, source_type, source_name, title, text, url, media_json,
            media_count, published_at, fetched_at, grouped_id, metadata
        FROM content_items_ru
        WHERE id = :id
    """), {"id": item_id}).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    data = _row_dict(row)
    data["media_json"] = _parse_json(data.get("media_json"))
    data["metadata"] = _parse_json(data.get("metadata"))
    return data


@app.get("/api/items/{item_id}/similar", response_model=list[SimilarItem])
def get_similar_items(item_id: int, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    current = db.execute(text("""
        SELECT id, title, text, source_name, published_at, content_hash, grouped_id
        FROM content_items_ru
        WHERE id = :id
    """), {"id": item_id}).fetchone()
    if current is None:
        raise HTTPException(status_code=404, detail="Item not found")

    current_data = _row_dict(current)
    search_text = f"{current_data.get('title') or ''} {current_data.get('text') or ''}".strip()
    base_select = """
        SELECT id, source_type, source_name, title, LEFT(text, 300) AS text_preview,
               url, published_at, grouped_id, content_type, media_count
        FROM content_items_ru
    """

    if search_text:
        rows = db.execute(text("""
            SELECT id, source_type, source_name, title, LEFT(text, 300) AS text_preview,
                   url, published_at, grouped_id, content_type, media_count,
                   MATCH(title, text) AGAINST(:search_text IN NATURAL LANGUAGE MODE) AS relevance
            FROM content_items_ru
            WHERE id != :id
              AND MATCH(title, text) AGAINST(:search_text IN NATURAL LANGUAGE MODE)
            ORDER BY relevance DESC, published_at DESC
            LIMIT 20
        """), {"search_text": search_text, "id": item_id}).fetchall()
        if rows:
            return [_row_dict(row) for row in rows]

    fallback_queries = [
        ("content_hash", current_data.get("content_hash")),
        ("grouped_id", current_data.get("grouped_id")),
        ("source_name", current_data.get("source_name")),
    ]
    for column, value in fallback_queries:
        if not value:
            continue
        rows = db.execute(text(base_select + f"""
            WHERE {column} = :value AND id != :id
            ORDER BY published_at DESC, id DESC
            LIMIT 20
        """), {"value": value, "id": item_id}).fetchall()
        if rows:
            return [dict(_row_dict(row), relevance=None) for row in rows]

    rows = db.execute(text(base_select + """
        WHERE id != :id
        ORDER BY published_at DESC, id DESC
        LIMIT 20
    """), {"id": item_id}).fetchall()
    return [dict(_row_dict(row), relevance=None) for row in rows]


def _keyword_counts(rows: list[Any]) -> list[dict[str, Any]]:
    counter: Counter[str] = Counter()
    for row in rows:
        data = _row_dict(row)
        raw_text = f"{data.get('title') or ''} {data.get('text') or ''}".lower()
        words = WORD_RE.findall(raw_text)
        counter.update(word for word in words if _is_allowed_word_tag(word))
    return [{"word": word, "count": count} for word, count in counter.most_common(50)]


def _tag_counts(rows: list[Any]) -> list[dict[str, Any]]:
    word_counter: Counter[str] = Counter()
    entity_counter: Counter[str] = Counter()
    for row in rows:
        data = _row_dict(row)
        raw_text = f"{data.get('title') or ''} {data.get('text') or ''}"
        words = WORD_RE.findall(raw_text.lower())
        word_counter.update(word for word in words if _is_allowed_word_tag(word))
        entity_counter.update(match.group(0) for match in ENTITY_RE.finditer(raw_text) if _is_allowed_entity_tag(raw_text, match))

    tags_by_key: dict[str, dict[str, Any]] = {}
    for tag, count in word_counter.items():
        tags_by_key[tag.lower()] = {"tag": tag, "count": count, "type": "word"}
    for tag, count in entity_counter.items():
        key = tag.lower()
        current = tags_by_key.get(key)
        if current is None or count >= current["count"]:
            tags_by_key[key] = {"tag": tag, "count": count, "type": "entity"}
        elif current["type"] == "word":
            current["type"] = "entity"

    return sorted(tags_by_key.values(), key=lambda entry: (-entry["count"], entry["tag"].lower()))[:80]


def _get_keywords(where_clause: str, db: Session) -> list[dict[str, Any]]:
    rows = db.execute(text(f"""
        SELECT title, text
        FROM content_items_ru
        WHERE {where_clause}
    """)).fetchall()
    return _keyword_counts(rows)


@app.get("/api/keywords/daily", response_model=list[Keyword])
def get_daily_keywords(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return _get_keywords("published_at >= CURDATE() AND published_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)", db)


@app.get("/api/keywords/five-days", response_model=list[Keyword])
def get_five_days_keywords(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return _get_keywords("published_at >= DATE_SUB(NOW(), INTERVAL 5 DAY)", db)


def _get_tags(where_clause: str, db: Session) -> list[dict[str, Any]]:
    rows = db.execute(text(f"""
        SELECT title, text
        FROM content_items_ru
        WHERE {where_clause}
    """)).fetchall()
    return _tag_counts(rows)


@app.get("/api/tags/daily", response_model=list[Tag])
def get_daily_tags(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return _get_tags("published_at >= CURDATE() AND published_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)", db)


@app.get("/api/tags/five-days", response_model=list[Tag])
def get_five_days_tags(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return _get_tags("published_at >= DATE_SUB(NOW(), INTERVAL 5 DAY)", db)
