import json
from typing import Any
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from .config import get_settings
from .db import get_db
from .schemas import ItemDetail, ItemList, SimilarItem, Source

settings = get_settings()
app = FastAPI(title="RuANAL Dashboard API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/api/items", response_model=list[ItemList])
def get_items(
    source_name: str | None = None,
    source_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = db.execute(text("""
        SELECT
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
        FROM content_items_ru
        WHERE (:source_name IS NULL OR source_name = :source_name)
          AND (:source_type IS NULL OR source_type = :source_type)
        ORDER BY published_at DESC, id DESC
        LIMIT :limit OFFSET :offset
    """), {
        "source_name": source_name,
        "source_type": source_type,
        "limit": limit,
        "offset": offset,
    }).fetchall()
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
        SELECT id, grouped_id, content_hash, source_name
        FROM content_items_ru
        WHERE id = :id
    """), {"id": item_id}).fetchone()
    if current is None:
        raise HTTPException(status_code=404, detail="Item not found")

    current_data = _row_dict(current)
    base_select = """
        SELECT id, source_type, source_name, title, LEFT(text, 300) AS text_preview,
               url, published_at, grouped_id, content_type, media_count
        FROM content_items_ru
    """

    if current_data.get("grouped_id"):
        rows = db.execute(text(base_select + """
            WHERE grouped_id = :grouped_id AND id != :id
            ORDER BY published_at DESC, id DESC
            LIMIT 20
        """), {"grouped_id": current_data["grouped_id"], "id": item_id}).fetchall()
        return [_row_dict(row) for row in rows]

    if current_data.get("content_hash"):
        rows = db.execute(text(base_select + """
            WHERE content_hash = :content_hash AND id != :id
            ORDER BY published_at DESC, id DESC
            LIMIT 20
        """), {"content_hash": current_data["content_hash"], "id": item_id}).fetchall()
        if rows:
            return [_row_dict(row) for row in rows]

    rows = db.execute(text(base_select + """
        WHERE source_name = :source_name AND id != :id
        ORDER BY published_at DESC, id DESC
        LIMIT 20
    """), {"source_name": current_data.get("source_name"), "id": item_id}).fetchall()
    return [_row_dict(row) for row in rows]
