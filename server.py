#!/usr/bin/env python3
"""Biblioteca de Resumos: servidor local.

Só usa a biblioteca padrão do Python. Ferramentas externas:
  - yt-dlp  (dados do vídeo e legendas)
  - claude  (Claude Code em modo headless, para escrever o resumo)

Arranque: python3 server.py   →   http://localhost:8765
"""
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATIC = ROOT / "static"
SEED = ROOT / "seed"
DB_PATH = DATA / "library.db"
SUMMARIES_DIR = DATA / "summaries"
TRANSCRIPTS_DIR = DATA / "transcripts"

PORT = int(os.environ.get("PORT", "8765"))
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
YTDLP_BIN = os.environ.get("YTDLP_BIN", "yt-dlp")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "")
CLAUDE_TIMEOUT = int(os.environ.get("CLAUDE_TIMEOUT", "1200"))
WORKERS = max(1, int(os.environ.get("WORKERS", "1")))  # resumos feitos ao mesmo tempo
MAX_TRANSCRIPT_CHARS = 220_000

QUALITY_LABELS = {
    "full_transcript": "Transcrição completa",
    "partial_transcript": "Transcrição parcial",
    "secondary_summaries": "Resumos de terceiros",
    "metadata_only": "Só descrição",
}

db_lock = threading.Lock()
jobs: "queue.Queue[int]" = queue.Queue()


# ---------------------------------------------------------------- base de dados

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA.mkdir(exist_ok=True)
    SUMMARIES_DIR.mkdir(exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(exist_ok=True)
    with db_lock, connect() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                youtube_id TEXT UNIQUE NOT NULL,
                url TEXT NOT NULL,
                title_original TEXT,
                title_pt TEXT,
                channel TEXT,
                guests TEXT DEFAULT '[]',
                published_at TEXT,
                duration_seconds INTEGER,
                tags TEXT DEFAULT '[]',
                lede TEXT,
                source_quality TEXT,
                content TEXT,
                html_file TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                step TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        cols = {r["name"] for r in c.execute("PRAGMA table_info(summaries)")}
        if "favorite" not in cols:
            c.execute("ALTER TABLE summaries ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0")
        empty = c.execute("SELECT COUNT(*) FROM summaries").fetchone()[0] == 0
    if empty:
        seed()


def seed():
    """Importa os resumos feitos antes da app (ficheiros HTML)."""
    seed_file = SEED / "seed.json"
    if not seed_file.exists():
        return
    items = json.loads(seed_file.read_text(encoding="utf-8"))
    with db_lock, connect() as c:
        for i, it in enumerate(items):
            src = SEED / it["file"]
            if not src.exists():
                continue
            dest = SUMMARIES_DIR / f"{it['youtube_id']}.html"
            shutil.copyfile(src, dest)
            ts = f"2026-10-17T12:{i:02d}:00+00:00"
            c.execute(
                """INSERT OR IGNORE INTO summaries
                (youtube_id, url, title_original, title_pt, channel, guests, published_at,
                 duration_seconds, tags, lede, source_quality, html_file, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ready', ?, ?)""",
                (
                    it["youtube_id"],
                    f"https://www.youtube.com/watch?v={it['youtube_id']}",
                    it.get("title_original"),
                    it.get("title_pt"),
                    it.get("channel"),
                    json.dumps(it.get("guests", []), ensure_ascii=False),
                    it.get("published_at"),
                    it.get("duration_seconds"),
                    json.dumps(it.get("tags", []), ensure_ascii=False),
                    it.get("lede"),
                    it.get("source_quality"),
                    dest.name,
                    ts,
                    ts,
                ),
            )


def row_to_dict(r, full=False):
    d = dict(r)
    d["guests"] = json.loads(d.get("guests") or "[]")
    d["tags"] = json.loads(d.get("tags") or "[]")
    d["quality_label"] = QUALITY_LABELS.get(d.get("source_quality") or "", "")
    d["favorite"] = bool(d.get("favorite"))
    content = d.pop("content", None)
    if full:
        d["content"] = json.loads(content) if content else None
    d["format"] = "html" if d.get("html_file") and not content else "json"
    return d


def update(sid, **fields):
    fields["updated_at"] = now_iso()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with db_lock, connect() as c:
        c.execute(f"UPDATE summaries SET {cols} WHERE id = ?", (*fields.values(), sid))


def get_row(sid):
    with db_lock, connect() as c:
        return c.execute("SELECT * FROM summaries WHERE id = ?", (sid,)).fetchone()


# ---------------------------------------------------------------- links

YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_id(text):
    text = text.strip()
    if not text:
        return None
    if YT_ID.match(text):
        return text
    if not re.match(r"^https?://", text):
        text = "https://" + text
    try:
        u = urlparse(text)
    except ValueError:
        return None
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if host == "youtu.be":
        vid = u.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com"):
        if u.path == "/watch":
            vid = parse_qs(u.query).get("v", [""])[0]
        else:
            m = re.match(r"^/(shorts|live|embed|v)/([^/?#]+)", u.path)
            vid = m.group(2) if m else ""
    else:
        return None
    return vid if YT_ID.match(vid or "") else None


def split_links(raw):
    return [p for p in re.split(r"[\s,;]+", raw or "") if p]


# ---------------------------------------------------------------- pipeline

def tool_available(name):
    return shutil.which(name) is not None


def fetch_metadata(url):
    if not tool_available(YTDLP_BIN):
        raise RuntimeError("yt-dlp não está instalado")
    p = subprocess.run(
        [YTDLP_BIN, "-J", "--skip-download", "--no-warnings", "--no-playlist", url],
        capture_output=True, text=True, timeout=180,
    )
    if p.returncode != 0:
        raise RuntimeError((p.stderr or "erro do yt-dlp").strip().splitlines()[-1][:300])
    return json.loads(p.stdout)


def pick_caption(meta):
    """Escolhe a melhor faixa de legendas: manuais primeiro, depois automáticas."""
    langs = ["en", "en-US", "en-GB", "pt", "pt-PT", "pt-BR", "en-orig"]
    for source, quality in ((meta.get("subtitles") or {}, "manual"), (meta.get("automatic_captions") or {}, "auto")):
        keys = list(source.keys())
        ordered = [k for k in langs if k in source] + [k for k in keys if k.split("-")[0] in ("en", "pt") and k not in langs]
        if quality == "manual" and not ordered:
            ordered = keys[:1]
        for k in ordered:
            tracks = source.get(k) or []
            for ext in ("json3", "vtt"):
                for t in tracks:
                    if t.get("ext") == ext and t.get("url"):
                        return t["url"], ext
    return None, None


def fetch_transcript(meta):
    url, ext = pick_caption(meta)
    if not url:
        return ""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode("utf-8", "replace")
    if ext == "json3":
        data = json.loads(raw)
        parts = []
        for ev in data.get("events", []):
            text = "".join(s.get("utf8", "") for s in ev.get("segs") or [])
            text = text.replace("\n", " ").strip()
            if text:
                parts.append(text)
        return re.sub(r"\s+", " ", " ".join(parts)).strip()
    # vtt: remove marcações e linhas repetidas
    lines, last = [], None
    for line in raw.splitlines():
        line = line.strip()
        if not line or "-->" in line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or line.isdigit():
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if line and line != last:
            lines.append(line)
            last = line
    return " ".join(lines)


def fmt_duration(sec):
    if not sec:
        return "desconhecida"
    sec = int(sec)
    h, m = divmod(sec // 60, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def fmt_ts(sec):
    sec = int(sec or 0)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def build_prompt(url, meta, transcript):
    tpl = (ROOT / "prompt.md").read_text(encoding="utf-8")
    chapters = meta.get("chapters") or []
    chapters_txt = "\n".join(f"{fmt_ts(c.get('start_time'))} {c.get('title', '')}" for c in chapters) or "(sem capítulos)"
    date = meta.get("upload_date") or ""
    if len(date) == 8:
        date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    if transcript:
        research = (
            "Tens a transcrição do episódio abaixo. Baseia-te nela. Só usa a web se precisares de "
            "confirmar um nome ou contexto."
        )
        transcript_txt = transcript[:MAX_TRANSCRIPT_CHARS]
        if len(transcript) > MAX_TRANSCRIPT_CHARS:
            transcript_txt += "\n[transcrição cortada por ser muito longa]"
    else:
        research = (
            "Não há transcrição disponível. Antes de escrever, usa WebFetch no URL do vídeo e WebSearch "
            "para encontrar transcrições (podscripts.co, Substack do programa, happyscribe) ou resumos "
            "publicados (shortform.com, podcastnotes.org, finance.biggo.com, site oficial do programa). "
            "Lê 1 a 3 das melhores fontes. Indica em source_quality e sources o que usaste."
        )
        transcript_txt = "(sem transcrição)"
    return (
        tpl.replace("{{RESEARCH_INSTRUCTIONS}}", research)
        .replace("{{URL}}", url)
        .replace("{{TITLE}}", meta.get("title") or "(desconhecido)")
        .replace("{{CHANNEL}}", meta.get("channel") or meta.get("uploader") or "(desconhecido)")
        .replace("{{DATE}}", date or "(desconhecida)")
        .replace("{{DURATION}}", fmt_duration(meta.get("duration")))
        .replace("{{CHAPTERS}}", chapters_txt)
        .replace("{{DESCRIPTION}}", (meta.get("description") or "")[:6000])
        .replace("{{TRANSCRIPT}}", transcript_txt)
    )


def extract_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("a resposta não trouxe JSON")
    return json.loads(text[start : end + 1])


REQUIRED = ["title_pt", "lede", "equation", "shift", "key_ideas", "steps"]


def validate(content):
    missing = [k for k in REQUIRED if not content.get(k)]
    if missing:
        raise ValueError("faltam campos no resumo: " + ", ".join(missing))
    for key in ("tags", "guests", "debate", "sources", "steps", "key_ideas", "equation"):
        if not isinstance(content.get(key, []), list):
            content[key] = []
    if content.get("source_quality") not in QUALITY_LABELS:
        content["source_quality"] = "metadata_only"
    return content


def run_claude(prompt):
    if not tool_available(CLAUDE_BIN):
        raise RuntimeError("o comando claude (Claude Code) não foi encontrado")
    cmd = [CLAUDE_BIN, "-p", "--output-format", "json", "--allowedTools", "WebSearch,WebFetch"]
    if CLAUDE_MODEL:
        cmd += ["--model", CLAUDE_MODEL]
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=CLAUDE_TIMEOUT, cwd=str(DATA))
    try:
        out = json.loads(p.stdout)
    except ValueError:
        msg = (p.stderr or p.stdout or "erro do claude").strip()
        raise RuntimeError(msg.splitlines()[-1][:300] if msg else "erro do claude")
    if out.get("is_error"):
        raise RuntimeError(str(out.get("result"))[:300])
    return out.get("result", "")


def process(sid):
    row = get_row(sid)
    if not row:
        return
    url = row["url"]
    vid = row["youtube_id"]
    try:
        update(sid, status="processing", step="metadata", error_message=None)
        meta = {}
        try:
            meta = fetch_metadata(url)
        except Exception as e:  # segue sem metadados; o Claude pesquisa na web
            print(f"[{vid}] metadados indisponíveis: {e}", file=sys.stderr)
        date = meta.get("upload_date") or ""
        update(
            sid,
            title_original=meta.get("title") or row["title_original"],
            channel=meta.get("channel") or meta.get("uploader") or row["channel"],
            published_at=f"{date[:4]}-{date[4:6]}-{date[6:]}" if len(date) == 8 else row["published_at"],
            duration_seconds=meta.get("duration") or row["duration_seconds"],
        )

        update(sid, step="transcript")
        transcript = ""
        tfile = TRANSCRIPTS_DIR / f"{vid}.txt"
        if tfile.exists():
            transcript = tfile.read_text(encoding="utf-8")
        elif meta:
            try:
                transcript = fetch_transcript(meta)
            except Exception as e:
                print(f"[{vid}] legendas indisponíveis: {e}", file=sys.stderr)
            if transcript:
                tfile.write_text(transcript, encoding="utf-8")

        update(sid, step="summary")
        prompt = build_prompt(url, meta, transcript)
        content = validate(extract_json(run_claude(prompt)))
        if transcript and content["source_quality"] in ("metadata_only", "secondary_summaries"):
            content["source_quality"] = "full_transcript"

        update(sid, step="saving")
        (SUMMARIES_DIR / f"{vid}.json").write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
        update(
            sid,
            title_pt=content.get("title_pt"),
            lede=content.get("lede"),
            guests=json.dumps(content.get("guests", []), ensure_ascii=False),
            tags=json.dumps(content.get("tags", []), ensure_ascii=False),
            source_quality=content["source_quality"],
            content=json.dumps(content, ensure_ascii=False),
            html_file=None,
            status="ready",
            step=None,
        )
        # versão HTML independente, para abrir sem a app
        (SUMMARIES_DIR / f"{vid}.html").write_text(standalone_html(get_row(sid)), encoding="utf-8")
        update(sid, html_file=f"{vid}.html")
    except subprocess.TimeoutExpired:
        update(sid, status="error", error_message="O resumo demorou demasiado tempo. Tenta outra vez.")
    except Exception as e:
        traceback.print_exc()
        update(sid, status="error", error_message=str(e)[:500])


def worker():
    while True:
        sid = jobs.get()
        try:
            process(sid)
        finally:
            jobs.task_done()


def requeue_unfinished():
    with db_lock, connect() as c:
        ids = [r[0] for r in c.execute("SELECT id FROM summaries WHERE status IN ('pending','processing') ORDER BY id")]
    for sid in ids:
        update(sid, status="pending", step=None)
        jobs.put(sid)


# ---------------------------------------------------------------- HTML independente

def standalone_html(row):
    d = row_to_dict(row, full=True)
    css = (STATIC / "summary.css").read_text(encoding="utf-8")
    js = (STATIC / "render.js").read_text(encoding="utf-8")
    payload = json.dumps({"meta": {k: v for k, v in d.items() if k != "content"}, "content": d["content"]}, ensure_ascii=False)
    payload = payload.replace("</", "<\\/")
    title = (d.get("title_pt") or "Resumo").replace("<", "")
    return f"""<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>{css}</style></head>
<body class="summary-page"><div id="root"></div>
<script>{js}</script>
<script>var D={payload};document.getElementById('root').innerHTML=renderSummary(D.content,D.meta);</script>
</body></html>"""


# ---------------------------------------------------------------- HTTP

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    server_version = "BibliotecaResumos/1.0"

    def log_message(self, fmt, *args):
        if "/api/jobs" in (args[0] if args else ""):
            return
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ctype=None):
        if not path.exists() or not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or MIME.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("pedido demasiado grande")
        return json.loads(self.rfile.read(n) or b"{}")

    # GET
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self.send_file(STATIC / "index.html")
        if path.startswith("/static/"):
            target = (STATIC / path[len("/static/"):]).resolve()
            if STATIC.resolve() not in target.parents:
                return self.send_error(HTTPStatus.FORBIDDEN)
            return self.send_file(target)
        if path == "/api/summaries":
            with db_lock, connect() as c:
                rows = c.execute("SELECT * FROM summaries ORDER BY COALESCE(published_at, '') DESC, created_at DESC").fetchall()
            return self.send_json([row_to_dict(r) for r in rows])
        m = re.match(r"^/api/summaries/(\d+)$", path)
        if m:
            r = get_row(int(m.group(1)))
            return self.send_json(row_to_dict(r, full=True)) if r else self.send_json({"error": "não encontrado"}, 404)
        if path == "/api/status":
            return self.send_json({
                "yt_dlp": tool_available(YTDLP_BIN),
                "claude": tool_available(CLAUDE_BIN),
                "queue": jobs.qsize(),
            })
        m = re.match(r"^/view/(\d+)$", path)
        if m:
            r = get_row(int(m.group(1)))
            if not r or not r["html_file"]:
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self.send_file(SUMMARIES_DIR / r["html_file"], "text/html; charset=utf-8")
        return self.send_error(HTTPStatus.NOT_FOUND)

    # POST
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except Exception:
            return self.send_json({"error": "pedido inválido"}, 400)

        if path == "/api/check":
            return self.send_json(self.check_links(body.get("text", "")))

        if path == "/api/jobs":
            result = self.check_links(body.get("text", ""))
            created = []
            for item in result["items"]:
                if item["state"] != "new":
                    continue
                ts = now_iso()
                with db_lock, connect() as c:
                    cur = c.execute(
                        "INSERT INTO summaries (youtube_id, url, status, created_at, updated_at) VALUES (?,?, 'pending', ?, ?)",
                        (item["youtube_id"], item["url"], ts, ts),
                    )
                    sid = cur.lastrowid
                jobs.put(sid)
                created.append(sid)
            return self.send_json({"created": created, "items": result["items"]})

        m = re.match(r"^/api/summaries/(\d+)/favorite$", path)
        if m:
            sid = int(m.group(1))
            if not get_row(sid):
                return self.send_json({"error": "não encontrado"}, 404)
            fav = bool(body.get("favorite"))
            with db_lock, connect() as c:
                c.execute("UPDATE summaries SET favorite = ? WHERE id = ?", (int(fav), sid))
            return self.send_json({"ok": True, "favorite": fav})

        m = re.match(r"^/api/summaries/(\d+)/(regenerate|retry)$", path)
        if m:
            sid = int(m.group(1))
            r = get_row(sid)
            if not r:
                return self.send_json({"error": "não encontrado"}, 404)
            if r["status"] in ("pending", "processing"):
                return self.send_json({"error": "já está em processamento"}, 409)
            update(sid, status="pending", step=None, error_message=None)
            jobs.put(sid)
            return self.send_json({"ok": True})
        return self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        m = re.match(r"^/api/summaries/(\d+)$", urlparse(self.path).path)
        if not m:
            return self.send_error(HTTPStatus.NOT_FOUND)
        sid = int(m.group(1))
        r = get_row(sid)
        if not r:
            return self.send_json({"error": "não encontrado"}, 404)
        if r["status"] == "processing":
            return self.send_json({"error": "espera que termine o processamento"}, 409)
        with db_lock, connect() as c:
            c.execute("DELETE FROM summaries WHERE id = ?", (sid,))
        for ext in (".json", ".html"):
            f = SUMMARIES_DIR / f"{r['youtube_id']}{ext}"
            if f.exists():
                f.unlink()
        return self.send_json({"ok": True})

    @staticmethod
    def check_links(text):
        seen, items = set(), []
        with db_lock, connect() as c:
            existing = {r["youtube_id"]: dict(r) for r in c.execute("SELECT id, youtube_id, title_pt, status FROM summaries")}
        for raw in split_links(text):
            vid = extract_id(raw)
            if not vid:
                items.append({"input": raw, "state": "invalid"})
                continue
            if vid in seen:
                items.append({"input": raw, "youtube_id": vid, "state": "repeated"})
                continue
            seen.add(vid)
            ex = existing.get(vid)
            url = f"https://www.youtube.com/watch?v={vid}"
            if ex:
                items.append({"input": raw, "youtube_id": vid, "url": url, "state": "exists", "id": ex["id"], "title": ex["title_pt"]})
            else:
                items.append({"input": raw, "youtube_id": vid, "url": url, "state": "new"})
        return {"items": items, "new": sum(1 for i in items if i["state"] == "new")}


def main():
    init_db()
    for _ in range(WORKERS):
        threading.Thread(target=worker, daemon=True).start()
    requeue_unfinished()
    missing = [n for n, b in (("yt-dlp", YTDLP_BIN), ("claude", CLAUDE_BIN)) if not tool_available(b)]
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"\n  Biblioteca de Resumos a correr em http://localhost:{PORT}\n")
    if missing:
        print("  Aviso: falta instalar " + " e ".join(missing) + ". Vê o README.md.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Até à próxima.")


if __name__ == "__main__":
    main()
