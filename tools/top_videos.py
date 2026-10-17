#!/usr/bin/env python3
"""Lista os vídeos mais vistos de canais do YouTube.

Para cada canal gera duas listas:
  - os N vídeos mais vistos de sempre;
  - os N vídeos mais vistos publicados este ano.

Só considera o separador "Vídeos" (não inclui Shorts nem diretos).
Precisa do yt-dlp (brew install yt-dlp).

Uso:
  python3 tools/top_videos.py                       # usa os canais de CHANNELS
  python3 tools/top_videos.py @hubermanlab @melrobbins -n 10 -o top.md
"""
import argparse
import json
import shutil
import subprocess
import sys
from datetime import date, datetime, timezone

CHANNELS = [
    "https://www.youtube.com/@TheDiaryOfACEO/videos",
    "https://www.youtube.com/@hubermanlab/videos",
    "https://www.youtube.com/@ChrisWillx/videos",
    "https://www.youtube.com/@melrobbins/videos",
    "https://www.youtube.com/@BenFelixCSI/videos",
    "https://www.youtube.com/@MechanicsOfPoker/videos",
]


def ytdlp_cmd():
    if shutil.which("yt-dlp"):
        return ["yt-dlp"]
    return [sys.executable, "-m", "yt_dlp"]


def run(args, timeout=900):
    p = subprocess.run(ytdlp_cmd() + args, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0 and not p.stdout.strip():
        last = (p.stderr or "erro desconhecido").strip().splitlines()[-1]
        raise RuntimeError(last)
    return p.stdout


def normalize_channel(c):
    c = c.strip()
    if c.startswith("@"):
        c = "https://www.youtube.com/" + c
    c = c.rstrip("/")
    for suffix in ("/videos", "/featured", "/shorts", "/streams"):
        if c.endswith(suffix):
            c = c[: -len(suffix)]
    return c + "/videos"


def entry_date(e):
    d = e.get("upload_date")
    if d and len(d) == 8:
        return date(int(d[:4]), int(d[4:6]), int(d[6:]))
    ts = e.get("timestamp") or e.get("release_timestamp")
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).date()
    return None


def list_channel(url):
    """Todos os vídeos do separador Vídeos, com visualizações e data aproximada."""
    out = run(["--flat-playlist", "-J", "--no-warnings", "--extractor-args", "youtubetab:approximate_date", url])
    data = json.loads(out)
    name = data.get("channel") or data.get("uploader") or data.get("title") or url
    videos = []
    for e in data.get("entries") or []:
        if not e or not e.get("id"):
            continue
        videos.append({
            "id": e["id"],
            "title": (e.get("title") or "").strip(),
            "views": e.get("view_count"),
            "date": entry_date(e),
            "approx": True,
        })
    # A lista do canal não traz as visualizações de alguns vídeos (muitas vezes os mais
    # recentes); sem isto ficavam de fora das duas listas. Vai buscá-las à página do vídeo.
    missing = [v for v in videos if v["views"] is None]
    if missing:
        exact_dates(missing)
        still = sum(1 for v in missing if v["views"] is None)
        print(f"  {len(missing)} vídeos sem visualizações na lista do canal; "
              f"{len(missing) - still} completados, {still} por completar", file=sys.stderr)
    return name, videos


def exact_dates(videos):
    """Confirma a data real dos vídeos (as datas da lista do canal são aproximadas)."""
    ids = [v["id"] for v in videos]
    result = {}
    for i in range(0, len(ids), 25):
        chunk = ids[i : i + 25]
        try:
            out = run(["--skip-download", "--no-warnings", "--ignore-errors", "--print", "%(id)s %(upload_date)s %(view_count)s"]
                      + [f"https://www.youtube.com/watch?v={x}" for x in chunk])
        except RuntimeError as e:
            # Acontece quando nenhum vídeo do bloco se consegue ler (ex.: só para membros).
            # Esses vídeos ficam sem visualizações e não entram nas listas.
            print(f"  aviso: {len(chunk)} vídeos não lidos ({e})", file=sys.stderr)
            continue
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2 and len(parts[1]) == 8 and parts[1].isdigit():
                d = parts[1]
                views = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None
                result[parts[0]] = (date(int(d[:4]), int(d[4:6]), int(d[6:])), views)
    for v in videos:
        if v["id"] in result:
            v["date"], views = result[v["id"]]
            v["approx"] = False
            if v["views"] is None:
                v["views"] = views


def this_year_videos(videos, year, n):
    """Os n vídeos mais vistos publicados no ano indicado, com a data exata.

    A lista do canal só tem datas aproximadas ("há 3 meses"). Em vez de confirmar a data
    de todos os vídeos perto da passagem de ano (centenas, em canais que publicam muito),
    confirma-a por ordem de visualizações, em blocos de 25, até ter n vídeos do ano.
    Se o canal publicou menos de n, acaba por ver todos os candidatos.
    """
    start = date(year, 1, 1)

    def maybe_this_year(v):
        d = v["date"]
        return d is None or d.year == year or abs((d - start).days) <= 60

    candidates = sorted([v for v in videos if v["views"] is not None and maybe_this_year(v)],
                        key=lambda v: v["views"], reverse=True)
    found = []
    for i in range(0, len(candidates), 25):
        if len(found) >= n:
            break
        chunk = candidates[i : i + 25]
        exact_dates([v for v in chunk if v["approx"]])
        found += [v for v in chunk if v["date"] and v["date"].year == year]
    unconfirmed = sum(1 for v in found[:n] if v["approx"])
    if unconfirmed:
        print(f"  aviso: {unconfirmed} datas não confirmadas (ficam aproximadas)", file=sys.stderr)
    return found


def fmt_views(n):
    if n is None:
        return "?"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f} M".replace(".", ",")
    if n >= 1_000:
        return f"{n / 1_000:.0f} mil"
    return str(n)


def table(videos, n, show_date=False):
    ranked = sorted([v for v in videos if v["views"] is not None], key=lambda v: v["views"], reverse=True)[:n]
    if not ranked:
        return "_Sem vídeos._\n"
    lines = []
    for i, v in enumerate(ranked, 1):
        extra = f", {v['date'].isoformat()}" if show_date and v["date"] else ""
        title = v["title"].replace("[", "(").replace("]", ")")
        lines.append(f"{i}. [{title}](https://www.youtube.com/watch?v={v['id']}) — {fmt_views(v['views'])} visualizações{extra}")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description="Vídeos mais vistos de canais do YouTube")
    ap.add_argument("channels", nargs="*", help="URLs ou @handles; por omissão usa a lista do script")
    ap.add_argument("-n", type=int, default=25, help="quantos vídeos por lista (25)")
    ap.add_argument("-y", "--year", type=int, default=date.today().year, help="ano para a segunda lista")
    ap.add_argument("-o", "--output", default=f"top-videos-{date.today().isoformat()}.md", help="ficheiro Markdown de saída")
    args = ap.parse_args()

    channels = [normalize_channel(c) for c in (args.channels or CHANNELS)]
    doc = [f"# Vídeos mais vistos por canal\n",
           f"Dados recolhidos a {date.today().strftime('%d/%m/%Y')} com o yt-dlp. Só o separador Vídeos (sem Shorts nem diretos).\n"]
    for url in channels:
        print(f"→ {url}", file=sys.stderr)
        try:
            name, videos = list_channel(url)
            print(f"  {len(videos)} vídeos encontrados", file=sys.stderr)
            year_videos = this_year_videos(videos, args.year, args.n)
            if len(year_videos) < args.n:
                print(f"  só {len(year_videos)} publicados em {args.year}", file=sys.stderr)
            else:
                print(f"  {args.n} mais vistos de {args.year} confirmados", file=sys.stderr)
        except Exception as e:
            doc.append(f"\n## {url}\n\nNão foi possível ler este canal: {e}\n")
            print(f"  erro: {e}", file=sys.stderr)
            continue
        doc.append(f"\n## {name}\n\n{url}\n")
        doc.append(f"\n### Os {args.n} mais vistos de sempre\n\n" + table(videos, args.n, show_date=False))
        doc.append(f"\n### Os {args.n} mais vistos de {args.year}\n\n" + table(year_videos, args.n, show_date=True))
        if len(year_videos) < args.n:
            doc.append(f"\n_O canal só publicou {len(year_videos)} vídeos em {args.year}._\n")

    with open(args.output, "w", encoding="utf-8") as f:
        f.write("".join(doc))
    print(f"\nPronto: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
