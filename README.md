# Biblioteca de Resumos

App pessoal que corre só no teu computador. Colas um ou mais links do YouTube e ela cria um resumo visual de cada episódio, em português, guardado numa biblioteca que podes pesquisar.

## Primeira vez

Precisas de três coisas no Mac:

1. **Python 3** (já vem com as ferramentas de linha de comandos da Apple). Confirma com `python3 --version`.
2. **yt-dlp**, para ler os dados e as legendas dos vídeos:
   ```
   brew install yt-dlp
   ```
3. **Claude Code** (`claude`), que escreve os resumos com a tua subscrição. Confirma com `claude --version`. Se nunca o usaste no terminal, corre `claude` uma vez para iniciar sessão.

Não é preciso instalar pacotes Python nem Node: a app só usa a biblioteca padrão.

## Arrancar

```
cd ~/Documents/biblioteca-resumos
./start.sh
```

Abre http://localhost:8765 no browser. Para parar, `Ctrl+C` no terminal.

## Como funciona

1. **Novo resumo**: colas um ou vários links (um por linha). A app avisa se algum é inválido ou já está na biblioteca.
2. Cada vídeo entra numa fila e é processado um de cada vez:
   - `yt-dlp` lê o título, canal, capítulos e legendas;
   - o `claude -p` escreve o resumo em JSON a partir da transcrição;
   - se o vídeo não tiver legendas, o Claude procura transcrições e resumos publicados na web e o resumo fica marcado como "Resumos de terceiros".
3. O resumo aparece na biblioteca. Podes pesquisar por título, convidado, canal ou tema, e filtrar por tema e canal.

Um episódio de 2 horas demora normalmente 1 a 3 minutos.

## Onde ficam os dados

Tudo dentro desta pasta, em `data/`:

- `library.db`: a biblioteca (SQLite);
- `summaries/`: cada resumo em JSON e em HTML (o HTML abre sozinho, sem a app);
- `transcripts/`: as transcrições, para poderes regenerar um resumo sem voltar ao YouTube.

Para fazer cópia de segurança, basta copiar a pasta `data/`.

Os seis primeiros resumos (Paddy Galloway, Sahar Yousef, David Friedberg, James Clear, Scott Kanoski, Zuckerberg e Wang) são importados de `seed/` na primeira vez que arrancas.

## Site público (GitHub Pages)

A pasta `docs/` é uma versão da biblioteca só de leitura, publicada em https://joaoxyxo.github.io/biblioteca-resumos/. Dá para pesquisar, filtrar e ler os resumos; os favoritos ficam guardados no browser de quem visita. Criar, apagar e regenerar resumos só funciona na app local.

Para atualizar o site com os resumos novos:

```
python3 tools/export_site.py
git add docs && git commit -m "Atualiza o site" && git push
```

O script copia só os resumos prontos. A base de dados e as transcrições (`data/`) nunca saem do teu computador.

## Ajustes

Variáveis de ambiente opcionais, por exemplo `PORT=9000 ./start.sh`:

| Variável | Para quê | Por omissão |
|---|---|---|
| `PORT` | Porta do servidor | `8765` |
| `CLAUDE_MODEL` | Modelo a usar no `claude -p` | o predefinido do Claude Code |
| `CLAUDE_TIMEOUT` | Tempo máximo por resumo, em segundos | `1200` |
| `WORKERS` | Quantos resumos são feitos ao mesmo tempo (mais rápido, mas gasta os limites da subscrição mais depressa) | `1` |
| `CLAUDE_BIN`, `YTDLP_BIN` | Caminho dos comandos, se não estiverem no PATH | `claude`, `yt-dlp` |

O texto com as instruções para o Claude está em `prompt.md`. Podes editá-lo para mudar o estilo dos resumos.

## Problemas comuns

- **"Falta instalar yt-dlp"**: `brew install yt-dlp`. Se o YouTube mudar algo e o yt-dlp falhar, atualiza com `brew upgrade yt-dlp`.
- **"o comando claude não foi encontrado"**: instala o Claude Code ou indica o caminho com `CLAUDE_BIN=/caminho/para/claude ./start.sh`.
- **Um resumo falhou**: aparece em "Em processamento" com o motivo e um botão "Tentar outra vez".
