#!/usr/bin/env python3
"""Exporta a biblioteca para um site estático só de leitura (GitHub Pages).

Gera a pasta docs/ com a app, a lista de resumos prontos e cada resumo:
  docs/index.html            a app em modo de leitura
  docs/static/               CSS, JS e ícone
  docs/data/library.json     a lista de resumos (sem transcrições)
  docs/data/s/<id>.json      o conteúdo dos resumos em JSON
  docs/view/<id>.html        os resumos que já existem em HTML

As transcrições e a base de dados nunca são copiadas.

Uso:
  python3 tools/export_site.py
Depois faz commit e push da pasta docs/.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  (reutiliza a ligação à base de dados e o formato da API)

OUT = ROOT / "docs"
# Campos internos que não interessam no site público
DROP = ("step", "error_message", "created_at")


def main():
    if not server.DB_PATH.exists():
        sys.exit("Não encontrei data/library.db. Arranca a app pelo menos uma vez.")
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "data" / "s").mkdir(parents=True)
    (OUT / "view").mkdir()
    (OUT / "static").mkdir()

    with server.connect() as c:
        rows = c.execute(
            "SELECT * FROM summaries WHERE status = 'ready' ORDER BY COALESCE(published_at, '') DESC, created_at DESC"
        ).fetchall()

    index = []
    skipped = 0
    for r in rows:
        d = server.row_to_dict(r, full=True)
        content = d.pop("content", None)
        if d["format"] == "html":
            src = server.SUMMARIES_DIR / (d.get("html_file") or "")
            if not src.is_file():
                skipped += 1
                continue
            shutil.copyfile(src, OUT / "view" / f"{d['id']}.html")
        else:
            if not content:
                skipped += 1
                continue
            (OUT / "data" / "s" / f"{d['id']}.json").write_text(json.dumps(content, ensure_ascii=False), encoding="utf-8")
            # o botão "Abrir HTML" só aparece para resumos com ficheiro HTML copiado
            d["html_file"] = None
        d["favorite"] = False
        for k in DROP:
            d.pop(k, None)
        index.append(d)

    (OUT / "data" / "library.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    for f in server.STATIC.iterdir():
        if f.suffix in (".css", ".js", ".svg"):
            shutil.copyfile(f, OUT / "static" / f.name)

    html = (server.STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace('"/static/', '"static/')
    html = html.replace('<script src="static/render.js">', '<script>window.STATIC_SITE = true;</script>\n<script src="static/render.js">')
    (OUT / "index.html").write_text(html, encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
    print(f"Exportados {len(index)} resumos para docs/ ({size:.1f} MB).")
    if skipped:
        print(f"Ignorados {skipped} resumos sem ficheiro de conteúdo.")


if __name__ == "__main__":
    main()
