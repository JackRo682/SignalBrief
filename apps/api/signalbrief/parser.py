"""Safe text extraction. Locations are offsets in normalized text, NOT original HTML offsets."""

import io
import re
import warnings
import zipfile
from dataclasses import dataclass
from hashlib import sha256

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from .errors import ParseError

PARSER_VERSION = "normalized-text-v1"
MAX_CHARS = 2_000_000


@dataclass(frozen=True)
class ParsedChunk:
    ordinal: int
    text: str
    char_start: int
    char_end: int
    location: str
    text_sha256: str


def decode(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp949", "utf-16"):
        try:
            return raw.decode(encoding)
        except UnicodeError:
            pass
    raise ParseError("unsupported_text_encoding")


def normalized_text(raw: bytes, mime: str) -> str:
    if raw.startswith(b"PK"):
        try:
            archive = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise ParseError("invalid_zip") from None
        with archive:
            members = archive.infolist()
            if len(members) > 300 or sum(m.file_size for m in members) > 60_000_000:
                raise ParseError("zip_expansion_limit")
            output = []
            for member in sorted(members, key=lambda m: m.filename):
                if member.is_dir():
                    continue
                if member.file_size > 25_000_000 or member.file_size / max(1, member.compress_size) > 300:
                    raise ParseError("zip_bomb_rejected")
                # Never extract members to a filesystem, so traversal cannot write outside storage.
                if member.filename.lower().endswith((".xml", ".html", ".htm", ".txt")):
                    output.append(
                        "[archive member: "
                        + member.filename[:200]
                        + "]\n"
                        + normalized_text(archive.read(member), "text/html")
                    )
                if sum(map(len, output)) > MAX_CHARS:
                    raise ParseError("parsed_text_limit")
            if not output:
                raise ParseError("zip_no_supported_text_document")
            return "\n\n".join(output)
    if raw.startswith(b"%PDF"):
        # A scanned PDF cannot safely be claimed as parsed; explicit review, not silent empty output.
        raise ParseError("pdf_requires_dedicated_parser_review")
    text = decode(raw)
    if "<!ENTITY" in text.upper() or "<!DOCTYPE" in text.upper() and "SYSTEM" in text.upper():
        raise ParseError("external_entity_rejected")
    if "<" in text and ">" in text:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
            soup = BeautifulSoup(text, "html.parser")
        for element in soup.find_all(["script", "style", "noscript", "iframe", "object", "ix:hidden"]):
            element.decompose()
        for element in list(soup.find_all(True)):
            if element.attrs and (
                element.has_attr("hidden")
                or re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", element.get("style", ""), re.I)
            ):
                element.decompose()
        # Keep table rows intact so numeric context remains visible to the extractor.
        for row in soup.find_all("tr"):
            row.replace_with(
                "\n"
                + " | ".join(
                    cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"], recursive=False)
                )
                + "\n"
            )
        text = soup.get_text("\n", strip=True)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    text = "\n".join(re.sub(r"[ 	]+", " ", line).strip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise ParseError("empty_extracted_text")
    if len(text) > MAX_CHARS:
        raise ParseError("parsed_text_limit")
    return text


def chunk_text(text: str, size=3600, overlap=300) -> list[ParsedChunk]:
    if size < 100 or not 0 <= overlap < size:
        raise ValueError("Invalid chunk size/overlap")
    result, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            boundary = text.rfind("\n", start + size // 2, end)
            if boundary > start:
                end = boundary
        part = text[start:end]
        result.append(
            ParsedChunk(
                len(result),
                part,
                start,
                end,
                f"normalized-text chars {start}:{end}",
                sha256(part.encode()).hexdigest(),
            )
        )
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return result
