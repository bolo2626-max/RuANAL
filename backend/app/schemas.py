from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict


class Source(BaseModel):
    source_type: str | None
    source_name: str | None
    count: int


class ItemList(BaseModel):
    id: int
    source_type: str | None
    source_name: str | None
    title: str | None
    text_preview: str | None
    url: str | None
    published_at: datetime | None
    grouped_id: int | None
    content_type: str | None
    media_count: int | None


class SimilarItem(BaseModel):
    id: int
    source_type: str | None
    source_name: str | None
    title: str | None
    text_preview: str | None
    url: str | None
    published_at: datetime | None
    grouped_id: int | None = None
    content_type: str | None = None
    media_count: int | None = None
    relevance: float | None = None


class Keyword(BaseModel):
    word: str
    count: int


class Tag(BaseModel):
    tag: str
    count: int
    type: str


class ItemDetail(BaseModel):
    id: int
    source_type: str | None
    source_name: str | None
    title: str | None
    text: str | None
    url: str | None
    media_json: Any | None
    media_count: int | None
    published_at: datetime | None
    fetched_at: datetime | None
    grouped_id: int | None
    metadata: Any | None

    model_config = ConfigDict(arbitrary_types_allowed=True)
