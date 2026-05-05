"""Split input text into ≤80-word chunks at sentence boundaries."""
import re


_SENTENCE_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z"\'\(])|(?<=[.!?])\s*\n')
_HARD_BREAK = re.compile(r'\n{2,}')

MAX_WORDS = 80


def _split_sentences(text: str) -> list[str]:
    paragraphs = _HARD_BREAK.split(text)
    sentences = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        parts = re.split(r'(?<=[.!?])\s+', para)
        for p in parts:
            p = p.strip()
            if p:
                sentences.append(p)
    return sentences


def chunk_text(text: str, max_words: int = MAX_WORDS) -> list[str]:
    sentences = _split_sentences(text)
    chunks: list[str] = []
    buf: list[str] = []
    buf_words = 0

    for sent in sentences:
        words = len(sent.split())
        if words > max_words:
            # sentence itself is too long — split by comma or just hard-cut
            if buf:
                chunks.append(" ".join(buf))
                buf, buf_words = [], 0
            # try comma splits
            sub = re.split(r',\s*', sent)
            sub_buf: list[str] = []
            sub_words = 0
            for s in sub:
                w = len(s.split())
                if sub_words + w > max_words and sub_buf:
                    chunks.append(", ".join(sub_buf))
                    sub_buf, sub_words = [s], w
                else:
                    sub_buf.append(s)
                    sub_words += w
            if sub_buf:
                chunks.append(", ".join(sub_buf))
            continue

        if buf_words + words > max_words and buf:
            chunks.append(" ".join(buf))
            buf, buf_words = [], 0

        buf.append(sent)
        buf_words += words

    if buf:
        chunks.append(" ".join(buf))

    return [c for c in chunks if c.strip()]
