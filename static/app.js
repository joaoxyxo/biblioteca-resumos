/* Biblioteca de Resumos: app de uma página (biblioteca, novo resumo, resumo). */
(function () {
  var app = document.getElementById('app');
  var esc = window.escapeHtml;
  var pollTimer = null;
  var STEPS = ['metadata', 'transcript', 'summary', 'saving'];
  var STEP_LABEL = {
    metadata: 'A obter dados do vídeo',
    transcript: 'A obter a transcrição',
    summary: 'A escrever o resumo (pode demorar 1 a 3 minutos)',
    saving: 'A guardar'
  };
  var ICON = {
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color:var(--muted)"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M9 7.5l7 4.5-7 4.5z"/></svg>',
    heart: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    heartSm: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V8l8-4 8 4v11"/><path d="M8 19v-6h8v6"/></svg>',
    ext: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/></svg>',
    redo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Site público (GitHub Pages): só leitura, dados exportados para ficheiros e favoritos guardados no browser
  var STATIC = !!window.STATIC_SITE;
  if (STATIC) document.body.classList.add('static-site');
  var FAV_KEY = 'biblioteca-favoritos';
  function readFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeFavs(f) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch (e) { /* sem armazenamento: só dura esta visita */ }
  }
  var staticIndex = null;
  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    });
  }
  function staticApi(method, url, body) {
    var favs = readFavs();
    if (!staticIndex) staticIndex = getJson('data/library.json');
    return staticIndex.then(function (rows) {
      rows.forEach(function (r) { r.favorite = !!favs[r.id]; });
      if (method === 'GET' && url === '/api/summaries') return rows;
      var m = url.match(/^\/api\/summaries\/(\d+)(\/favorite)?$/);
      var row = m && rows.filter(function (r) { return r.id === Number(m[1]); })[0];
      if (!row) throw new Error('não encontrado');
      if (m[2] && method === 'POST') {
        if (body.favorite) favs[row.id] = true; else delete favs[row.id];
        writeFavs(favs);
        return { ok: true, favorite: !!body.favorite };
      }
      if (row.format !== 'json') return row;
      return getJson('data/s/' + row.id + '.json').then(function (content) { return Object.assign({}, row, { content: content }); });
    });
  }
  function viewUrl(id) { return STATIC ? 'view/' + id + '.html' : '/view/' + id; }

  function api(method, url, body) {
    if (STATIC) return staticApi(method, url, body);
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
        return j;
      });
    });
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function fmtDate(d) {
    if (!d || d.length < 10) return '';
    return parseInt(d.slice(8, 10), 10) + ' ' + MONTHS[parseInt(d.slice(5, 7), 10) - 1] + ' ' + d.slice(0, 4);
  }
  function fmtDur(s) {
    if (!s) return '';
    var m = Math.round(s / 60), h = Math.floor(m / 60);
    return h ? h + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min';
  }
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
  function poll(fn, ms) { stopPoll(); pollTimer = setTimeout(fn, ms || 3000); }
  function isBusy(s) { return s.status === 'pending' || s.status === 'processing'; }

  function progress(s) {
    var idx = s.status === 'pending' ? -1 : STEPS.indexOf(s.step);
    return '<div class="prog" aria-hidden="true">' + STEPS.map(function (_, i) {
      return '<i class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"></i>';
    }).join('') + '</div>';
  }
  function jobRow(s) {
    var title = s.title_pt || s.title_original || s.url;
    var line;
    if (s.status === 'error') line = 'Falhou: ' + (s.error_message || 'erro desconhecido');
    else if (s.status === 'pending') line = 'Na fila';
    else line = STEP_LABEL[s.step] || 'A processar';
    var actions = s.status === 'error'
      ? '<button class="btn sm ghost" data-retry="' + s.id + '">Tentar outra vez</button><button class="btn sm ghost" data-remove="' + s.id + '">Remover</button>'
      : progress(s);
    return '<div class="job' + (s.status === 'error' ? ' error' : '') + '"><div class="info"><b>' + esc(title) + '</b><span role="status">' + esc(line) + '</span></div>' + actions + '</div>';
  }
  function bindJobActions(root, after) {
    root.querySelectorAll('[data-retry]').forEach(function (b) {
      b.onclick = function () { api('POST', '/api/summaries/' + b.dataset.retry + '/retry').then(after).catch(alertBanner); };
    });
    root.querySelectorAll('[data-remove]').forEach(function (b) {
      b.onclick = function () { api('DELETE', '/api/summaries/' + b.dataset.remove).then(after).catch(alertBanner); };
    });
  }
  function alertBanner(e) {
    var b = document.getElementById('banner');
    b.textContent = e && e.message ? e.message : String(e);
    b.hidden = false;
    setTimeout(function () { b.hidden = true; checkTools(); }, 6000);
  }

  /* ---------------------------------------------------------------- biblioteca */
  var PAGE = 60;
  var POPULAR = 8;
  var lib = { query: '', view: 'all', tags: [], channels: [], limit: PAGE };
  function resetFilters() { lib = { query: '', view: 'all', tags: [], channels: [], limit: PAGE }; }

  function viewLibrary() {
    app.innerHTML =
      '<div class="shell">' +
      '<header class="top"><div style="display:flex;flex-direction:column;gap:6px"><div class="kicker">Podcasts resumidos</div>' +
      '<h1>Biblioteca de Resumos</h1><div class="muted" id="count"></div></div>' +
      (STATIC ? '' : '<a class="btn dark" href="#/novo">' + ICON.plus + 'Novo resumo</a>') + '</header>' +
      '<div class="finder">' +
      '<label class="label" for="q">Pesquisar</label>' +
      '<div class="search">' + ICON.search + '<input id="q" type="search" autocomplete="off" placeholder="Título, convidado, canal ou tema"></div>' +
      '<div id="filters"></div></div>' +
      '<div id="jobs" class="jobs" hidden></div>' +
      '<div id="list"></div></div>';
    var q = document.getElementById('q');
    q.value = lib.query;
    q.oninput = function () { lib.query = q.value; lib.limit = PAGE; drawList(); };
    bindCards(document.getElementById('list'));
    libSig = '';
    loadLibrary();
  }

  var libData = [];
  var libSig = '';
  var jobsOpen = false;
  function loadLibrary() {
    api('GET', '/api/summaries').then(function (rows) {
      if (!document.getElementById('list')) return;
      libData = rows;
      // Só redesenha os cards quando algo mudou, para o polling não repetir as animações
      var sig = JSON.stringify(rows.filter(function (r) { return r.status === 'ready'; }).map(function (r) { return [r.id, r.favorite, r.updated_at]; }));
      if (sig !== libSig) {
        var first = !libSig;
        libSig = sig;
        drawFilters();
        drawList(first);
      }
      var busy = rows.filter(isBusy);
      var jobsEl = document.getElementById('jobs');
      var shown = rows.filter(function (r) { return isBusy(r) || r.status === 'error'; });
      var ORDER = { error: 0, processing: 1, pending: 2 };
      shown.sort(function (x, y) { return ORDER[x.status] - ORDER[y.status]; });
      // Com muitos vídeos na fila, mostra só os primeiros e um botão para ver todos
      var errors = shown.filter(function (r) { return r.status === 'error'; }).length;
      var list = jobsOpen ? shown : shown.slice(0, 3);
      var head = shown.length + ' em processamento' + (errors ? ' · ' + errors + (errors === 1 ? ' falhou' : ' falharam') : '');
      jobsEl.innerHTML = shown.length ? '<div class="label">' + head + '</div>' + list.map(jobRow).join('') +
        (shown.length > 3 ? '<button type="button" class="btn ghost sm" id="jobsmore" aria-expanded="' + jobsOpen + '">' + (jobsOpen ? 'Mostrar menos' : 'Ver todos (' + shown.length + ')') + '</button>' : '') : '';
      jobsEl.hidden = !shown.length;
      var jm = document.getElementById('jobsmore');
      if (jm) jm.onclick = function () { jobsOpen = !jobsOpen; loadLibrary(); };
      bindJobActions(jobsEl, loadLibrary);
      if (busy.length) poll(loadLibrary, 3000); else stopPoll();
    }).catch(alertBanner);
  }

  /* Filtros: Todos/Favoritos, menus de Temas e Canais (escolha múltipla), temas populares e filtros ativos */
  function readyRows() { return libData.filter(function (r) { return r.status === 'ready'; }); }
  function chKey(c) { return String(c || '').trim().toLowerCase(); }
  var facets = { tags: [], channels: [] };

  function buildFacets() {
    var ready = readyRows();
    var tc = {}, cc = {}, spell = {};
    ready.forEach(function (r) {
      r.tags.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; });
      if (!r.channel) return;
      var k = chKey(r.channel);
      cc[k] = (cc[k] || 0) + 1;
      spell[k] = spell[k] || {};
      spell[k][r.channel] = (spell[k][r.channel] || 0) + 1;
    });
    function byCount(counts) {
      return function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, 'pt'); };
    }
    facets.tags = Object.keys(tc).sort(byCount(tc)).map(function (t) { return { key: t, name: t, n: tc[t] }; });
    facets.channels = Object.keys(cc).sort(function (a, b) { return a.localeCompare(b, 'pt'); }).map(function (k) {
      // o canal pode aparecer com maiúsculas diferentes; mostra a grafia mais usada
      var names = Object.keys(spell[k]).sort(function (a, b) { return spell[k][b] - spell[k][a]; });
      return { key: k, name: names[0], n: cc[k] };
    });
    lib.tags = lib.tags.filter(function (t) { return tc[t]; });
    lib.channels = lib.channels.filter(function (k) { return cc[k]; });
  }

  function dropdown(id, label, items, selected) {
    return '<div class="dd" id="dd-' + id + '">' +
      '<button type="button" class="ddbtn" aria-expanded="false" aria-controls="ddp-' + id + '"><span class="ddlabel"></span>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="ddpanel" id="ddp-' + id + '" hidden role="dialog" aria-label="' + label + '">' +
      '<div class="ddhead"><span class="grab" aria-hidden="true"></span><b>' + label + '</b></div>' +
      '<div class="ddsearch">' + ICON.search + '<input type="search" autocomplete="off" aria-label="Procurar ' + label.toLowerCase() + '" placeholder="Procurar ' + label.toLowerCase() + '"></div>' +
      '<div class="opts" role="group" aria-label="' + label + '">' + items.map(function (it) {
        return '<label class="opt" data-name="' + esc(norm(it.name)) + '"><input type="checkbox" value="' + esc(it.key) + '"' + (selected.indexOf(it.key) !== -1 ? ' checked' : '') + '>' +
          '<span class="nm">' + esc(it.name) + '</span><span class="c">' + it.n + '</span></label>';
      }).join('') + '<p class="none" hidden>Sem resultados.</p></div>' +
      '<div class="ddfoot"><button type="button" class="btn sm ghost" data-clear>Limpar</button><button type="button" class="btn sm dark" data-done>Feito</button></div>' +
      '</div></div>';
  }

  function drawFilters() {
    buildFacets();
    var el = document.getElementById('filters');
    if (!el) return;
    el.innerHTML =
      '<div class="toolbar">' +
      '<div class="seg" role="group" aria-label="Mostrar">' +
      '<button type="button" data-view="all">Todos</button>' +
      '<button type="button" data-view="fav">' + ICON.heartSm + 'Favoritos<span class="badge" id="favcount"></span></button></div>' +
      dropdown('tags', 'Temas', facets.tags, lib.tags) +
      dropdown('channels', 'Canais', facets.channels, lib.channels) +
      '</div>' +
      '<div class="quick"><span class="label">Populares</span><div class="qrow">' + facets.tags.slice(0, POPULAR).map(function (t) {
        return '<button type="button" class="pill" data-qtag="' + esc(t.key) + '">' + esc(t.name) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="activef" id="activef"></div>';

    el.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () { location.hash = b.dataset.view === 'fav' ? '#/favoritos' : '#/'; };
    });
    el.querySelectorAll('[data-qtag]').forEach(function (b) {
      b.onclick = function () { toggleIn(lib.tags, b.dataset.qtag); syncChecks(); filtersChanged(); };
    });
    [['tags', lib.tags], ['channels', lib.channels]].forEach(function (pair) {
      var dd = document.getElementById('dd-' + pair[0]);
      var btn = dd.querySelector('.ddbtn'), panel = dd.querySelector('.ddpanel'), search = dd.querySelector('input[type=search]');
      btn.onclick = function () { setOpen(dd, panel.hidden); if (!panel.hidden) search.focus(); };
      search.oninput = function () {
        var qq = norm(search.value.trim()), any = false;
        dd.querySelectorAll('.opt').forEach(function (o) {
          var show = !qq || o.dataset.name.indexOf(qq) !== -1;
          o.hidden = !show; any = any || show;
        });
        dd.querySelector('.none').hidden = any;
      };
      dd.querySelectorAll('.opt input').forEach(function (cb) {
        cb.onchange = function () { toggleIn(lib[pair[0]], cb.value, cb.checked); filtersChanged(); };
      });
      dd.querySelector('[data-clear]').onclick = function () { lib[pair[0]].length = 0; syncChecks(); filtersChanged(); };
      dd.querySelector('[data-done]').onclick = function () { setOpen(dd, false); btn.focus(); };
    });
    updateFilterUI();
  }

  function toggleIn(arr, v, force) {
    var i = arr.indexOf(v);
    var on = force === undefined ? i === -1 : force;
    if (on && i === -1) arr.push(v);
    if (!on && i !== -1) arr.splice(i, 1);
  }
  function setOpen(dd, open) {
    document.querySelectorAll('.dd').forEach(function (d) {
      var o = d === dd && open;
      d.querySelector('.ddpanel').hidden = !o;
      d.querySelector('.ddbtn').setAttribute('aria-expanded', o);
      d.classList.toggle('open', o);
    });
    document.body.classList.toggle('sheet-open', !!(dd && open));
  }
  function syncChecks() {
    [['tags', lib.tags], ['channels', lib.channels]].forEach(function (pair) {
      document.querySelectorAll('#dd-' + pair[0] + ' .opt input').forEach(function (cb) { cb.checked = pair[1].indexOf(cb.value) !== -1; });
    });
  }
  function filtersChanged() { lib.limit = PAGE; updateFilterUI(); drawList(true); }

  function updateFilterUI() {
    var el = document.getElementById('filters');
    if (!el) return;
    var favCount = readyRows().filter(function (r) { return r.favorite; }).length;
    var badge = document.getElementById('favcount');
    badge.textContent = favCount;
    badge.hidden = !favCount;
    el.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === lib.view); });
    el.querySelectorAll('[data-qtag]').forEach(function (b) { b.setAttribute('aria-pressed', lib.tags.indexOf(b.dataset.qtag) !== -1); });
    function label(base, sel, list) {
      if (!sel.length) return base;
      if (sel.length === 1) return list.filter(function (x) { return x.key === sel[0]; })[0].name;
      return base + ' · ' + sel.length;
    }
    var tb = document.querySelector('#dd-tags .ddlabel'), cb = document.querySelector('#dd-channels .ddlabel');
    tb.textContent = label('Temas', lib.tags, facets.tags);
    cb.textContent = label('Canais', lib.channels, facets.channels);
    tb.parentNode.classList.toggle('on', lib.tags.length > 0);
    cb.parentNode.classList.toggle('on', lib.channels.length > 0);

    var chips = lib.channels.map(function (k) {
      var c = facets.channels.filter(function (x) { return x.key === k; })[0];
      return '<button type="button" class="achip" data-rm-ch="' + esc(k) + '" aria-label="Remover canal ' + esc(c.name) + '"><span class="muted">Canal</span>' + esc(c.name) + ICON.x + '</button>';
    }).concat(lib.tags.map(function (t) {
      return '<button type="button" class="achip" data-rm-tag="' + esc(t) + '" aria-label="Remover tema ' + esc(t) + '"><span class="muted">Tema</span>' + esc(t) + ICON.x + '</button>';
    }));
    var act = document.getElementById('activef');
    act.innerHTML = chips.length ? chips.join('') + '<button type="button" class="linkbtn" id="clearall">Limpar filtros</button>' : '';
    act.hidden = !chips.length;
    act.querySelectorAll('[data-rm-ch]').forEach(function (b) { b.onclick = function () { toggleIn(lib.channels, b.dataset.rmCh, false); syncChecks(); filtersChanged(); }; });
    act.querySelectorAll('[data-rm-tag]').forEach(function (b) { b.onclick = function () { toggleIn(lib.tags, b.dataset.rmTag, false); syncChecks(); filtersChanged(); }; });
    var ca = document.getElementById('clearall');
    if (ca) ca.onclick = function () { lib.tags.length = 0; lib.channels.length = 0; syncChecks(); filtersChanged(); };
  }

  // Fecha os menus ao clicar fora ou com Escape
  document.addEventListener('click', function (e) {
    var dd = e.target.closest('.dd');
    if (!dd || e.target === dd) setOpen(null, false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.dd.open');
    if (open) { setOpen(null, false); open.querySelector('.ddbtn').focus(); }
  });

  function filteredRows() {
    var q = norm(lib.query.trim());
    return readyRows().filter(function (r) {
      if (lib.view === 'fav' && !r.favorite) return false;
      if (lib.tags.length && !r.tags.some(function (t) { return lib.tags.indexOf(t) !== -1; })) return false;
      if (lib.channels.length && lib.channels.indexOf(chKey(r.channel)) === -1) return false;
      if (!q) return true;
      return norm([r.title_pt, r.title_original, r.channel, r.guests.join(' '), r.tags.join(' '), r.lede].join(' ')).indexOf(q) !== -1;
    });
  }

  function drawList(animate) {
    var ready = readyRows();
    var rows = filteredRows();
    var favCount = ready.filter(function (r) { return r.favorite; }).length;
    document.getElementById('count').textContent = (rows.length === ready.length ? ready.length + ' resumos' : rows.length + ' de ' + ready.length + ' resumos') +
      (favCount ? ' · ' + favCount + (favCount === 1 ? ' favorito' : ' favoritos') : '');
    var list = document.getElementById('list');
    if (!ready.length) {
      list.innerHTML = '<div class="empty"><h2>Ainda não há resumos</h2><p>Cola um ou mais links do YouTube e a app cria um resumo visual de cada episódio.</p><a class="btn dark" href="#/novo">' + ICON.plus + 'Novo resumo</a></div>';
      return;
    }
    if (!rows.length && lib.view === 'fav' && !favCount) {
      list.innerHTML = '<div class="empty"><h2>Ainda não tens favoritos</h2><p>Toca no coração de um resumo para o guardares aqui.</p></div>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><h2>Nenhum resumo encontrado</h2><p>Experimenta outra palavra ou limpa os filtros.</p><button class="btn outline" id="clear">Limpar filtros</button></div>';
      document.getElementById('clear').onclick = function () {
        resetFilters();
        document.getElementById('q').value = '';
        drawFilters(); drawList(true);
      };
      return;
    }
    var shown = rows.slice(0, lib.limit);
    var rest = rows.length - shown.length;
    list.innerHTML = '<div class="cards' + (animate ? ' enter' : '') + '">' + shown.map(cardHtml).join('') + '</div>' +
      (rest > 0 ? '<div class="more"><button type="button" class="btn ghost" id="more">Mostrar mais ' + Math.min(rest, PAGE) + '</button><span class="muted">' + shown.length + ' de ' + rows.length + '</span></div>' : '');
    var more = document.getElementById('more');
    if (more) more.onclick = function () {
      var grid = list.querySelector('.cards');
      var next = rows.slice(lib.limit, lib.limit + PAGE);
      lib.limit += PAGE;
      grid.classList.remove('enter');
      grid.insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
      var left = rows.length - lib.limit;
      if (left > 0) {
        more.textContent = 'Mostrar mais ' + Math.min(left, PAGE);
        more.nextSibling.textContent = lib.limit + ' de ' + rows.length;
      } else more.parentNode.remove();
    };
  }

  function cardHtml(r) {
    var meta = [r.channel, fmtDate(r.published_at)].filter(Boolean).join(' · ');
    var href = '#/r/' + r.id;
    return '<article class="rcard' + (r.favorite ? ' fav-on' : '') + '" data-id="' + r.id + '">' +
      '<a class="cover" href="' + href + '" tabindex="-1" aria-hidden="true"></a>' +
      '<span class="topline" aria-hidden="true"></span>' +
      '<div class="head"><div><span class="meta">' + esc(meta) + '</span>' + (r.favorite ? '<span class="flag">Favorito</span>' : '') + '</div>' +
      favButton(r) + '</div>' +
      '<div class="titles"><h2><a href="' + href + '">' + esc(r.title_pt || r.title_original) + '</a></h2>' +
      (r.guests.length ? '<div class="guest">com ' + esc(r.guests.join(' e ')) + '</div>' : '') + '</div>' +
      (r.lede ? '<div class="lede">' + esc(r.lede) + '</div>' : '') +
      '<div class="tags">' + r.tags.map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<div class="foot"><span class="go">Ler resumo' + ICON.arrow + '</span><span><span>' + esc(fmtDur(r.duration_seconds)) + '</span>' +
      (r.quality_label ? '<span class="q ' + esc(r.source_quality) + '">' + esc(r.quality_label) + '</span>' : '') + '</span></div></article>';
  }
  function favButton(r) {
    var title = r.title_pt || r.title_original || '';
    return '<button type="button" class="fav' + (r.favorite ? ' on' : '') + '" data-fav="' + r.id + '" aria-pressed="' + !!r.favorite + '" aria-label="' +
      esc((r.favorite ? 'Remover dos favoritos: ' : 'Adicionar aos favoritos: ') + title) + '">' +
      '<span class="burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' + ICON.heart + '</button>';
  }

  // Inclinação 3D e holofote que seguem o cursor; cliques no coração
  function bindCards(list) {
    list.addEventListener('mousemove', function (e) {
      if (reduceMotion.matches || !finePointer.matches) return;
      var card = e.target.closest('.rcard');
      if (!card) return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      card.style.setProperty('--ry', ((x - 0.5) * 5).toFixed(2) + 'deg');
      card.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
    });
    list.addEventListener('mouseout', function (e) {
      var card = e.target.closest('.rcard');
      if (!card || card.contains(e.relatedTarget)) return;
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fav]');
      if (b) setFavorite(Number(b.dataset.fav), !b.classList.contains('on'), true);
    });
  }

  function setFavorite(id, on, withToast) {
    var row = libData.filter(function (r) { return r.id === id; })[0];
    if (!row || row.favorite === on) return;
    row.favorite = on;
    paintFavorite(row, true);
    if (withToast) showToast(row, on);
    api('POST', '/api/summaries/' + id + '/favorite', { favorite: on }).catch(function (e) {
      row.favorite = !on;
      paintFavorite(row, false);
      alertBanner(e);
    });
  }
  // Atualiza o card no sítio (sem redesenhar a grelha) para a animação do coração correr
  function paintFavorite(row, animate) {
    var card = document.querySelector('.rcard[data-id="' + row.id + '"]');
    if (lib.view === 'fav' && !row.favorite) { drawList(false); }
    else if (card) {
      card.classList.toggle('fav-on', row.favorite);
      var head = card.querySelector('.head');
      head.innerHTML = '<div><span class="meta">' + esc(card.querySelector('.meta').textContent) + '</span>' +
        (row.favorite ? '<span class="flag">Favorito</span>' : '') + '</div>' + favButton(row);
      if (animate && row.favorite) head.querySelector('.fav').classList.add('pop');
    } else drawList(false);
    var ready = libData.filter(function (r) { return r.status === 'ready'; });
    var favCount = ready.filter(function (r) { return r.favorite; }).length;
    var badge = document.getElementById('favcount');
    if (badge) {
      badge.textContent = favCount;
      badge.hidden = !favCount;
      badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
    }
    var count = document.getElementById('count');
    if (count) count.textContent = count.textContent.replace(/ · \d+ favoritos?$/, '') + (favCount ? ' · ' + favCount + (favCount === 1 ? ' favorito' : ' favoritos') : '');
  }

  var toastTimer = null;
  function showToast(row, on) {
    var old = document.getElementById('toast');
    if (old) old.remove();
    clearTimeout(toastTimer);
    var t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = ICON.heartSm + '<span>' + (on ? 'Adicionado aos favoritos' : 'Removido dos favoritos') + '</span><button type="button">Desfazer</button>';
    t.querySelector('button').onclick = function () { t.remove(); setFavorite(row.id, !on, false); };
    document.body.appendChild(t);
    toastTimer = setTimeout(function () { t.remove(); }, 4000);
  }

  /* ---------------------------------------------------------------- novo resumo */
  var draft = '';
  var submitted = [];

  function viewNew() {
    app.innerHTML =
      '<div class="shell narrow">' +
      '<a class="back" href="#/">' + ICON.back + 'Biblioteca</a>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><h1 style="font-size:40px">Novo resumo</h1>' +
      '<p class="muted" style="font-size:17px;max-width:600px">Cola um ou mais links do YouTube, um por linha. Os resumos são feitos aqui no teu computador, um de cada vez, e ficam guardados na biblioteca.</p></div>' +
      '<form id="f" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="label" for="links">Links do YouTube</label>' +
      '<textarea id="links" spellcheck="false" placeholder="https://www.youtube.com/watch?v=…&#10;https://youtu.be/…"></textarea>' +
      '<div id="checks"></div>' +
      '<div class="row"><button class="btn dark" id="go" type="submit" disabled>Resumir</button><span class="muted" id="hint" style="font-size:14px"></span></div>' +
      '</form>' +
      '<div id="progress" class="jobs"></div>' +
      '<p class="muted" style="font-size:14px">Primeiro tenta as legendas do YouTube. Se não existirem, procura transcrições e resumos publicados e indica isso no resumo.</p>' +
      '</div>';
    var ta = document.getElementById('links');
    ta.value = draft;
    var t = null;
    ta.oninput = function () { draft = ta.value; clearTimeout(t); t = setTimeout(checkLinks, 250); };
    document.getElementById('f').onsubmit = function (e) {
      e.preventDefault();
      var btn = document.getElementById('go');
      btn.disabled = true;
      api('POST', '/api/jobs', { text: ta.value }).then(function (res) {
        submitted = submitted.concat(res.created);
        draft = ''; ta.value = '';
        checkLinks();
        loadProgress();
      }).catch(alertBanner);
    };
    checkLinks();
    loadProgress();
    ta.focus();
  }

  var STATE_LABEL = { 'new': 'Novo', exists: 'Já está na biblioteca', invalid: 'Link inválido', repeated: 'Repetido' };
  function checkLinks() {
    var el = document.getElementById('checks');
    if (!el) return;
    var text = document.getElementById('links').value;
    if (!text.trim()) { el.innerHTML = ''; setGo(0); return; }
    api('POST', '/api/check', { text: text }).then(function (res) {
      if (!document.getElementById('checks')) return;
      el.innerHTML = res.items.length ? '<div class="checks">' + res.items.map(function (i) {
        var label = i.state === 'exists' && i.id
          ? '<a class="st exists" href="#/r/' + i.id + '">' + STATE_LABEL.exists + '</a>'
          : '<span class="st ' + i.state + '">' + STATE_LABEL[i.state] + '</span>';
        return '<div class="check"><span class="u">' + esc(i.state === 'exists' && i.title ? i.title : i.input) + '</span>' + label + '</div>';
      }).join('') + '</div>' : '';
      setGo(res['new']);
    }).catch(function () { setGo(0); });
  }
  function setGo(n) {
    var btn = document.getElementById('go');
    if (!btn) return;
    btn.disabled = n === 0;
    btn.textContent = n > 1 ? 'Resumir ' + n + ' vídeos' : 'Resumir';
    document.getElementById('hint').textContent = n > 1 ? 'Ficam na fila e são feitos um a seguir ao outro.' : '';
  }
  function loadProgress() {
    var el = document.getElementById('progress');
    if (!el || !submitted.length) return;
    api('GET', '/api/summaries').then(function (rows) {
      if (!document.getElementById('progress')) return;
      var mine = rows.filter(function (r) { return submitted.indexOf(r.id) !== -1; });
      el.innerHTML = mine.length ? '<div class="label">Progresso</div>' + mine.map(function (r) {
        if (r.status === 'ready') {
          return '<div class="job"><div class="info"><b>' + esc(r.title_pt || r.title_original) + '</b><span>Resumo pronto</span></div><a class="btn sm dark" href="#/r/' + r.id + '">Abrir resumo</a></div>';
        }
        return jobRow(r);
      }).join('') : '';
      bindJobActions(el, loadProgress);
      if (mine.some(isBusy)) poll(loadProgress, 3000); else stopPoll();
    }).catch(alertBanner);
  }

  /* ---------------------------------------------------------------- resumo */
  function viewSummary(id) {
    app.innerHTML = '<div class="shell"><p class="muted">A abrir…</p></div>';
    api('GET', '/api/summaries/' + id).then(function (s) {
      var bar = '<div class="bar"><div class="in">' +
        '<a class="back" href="#/" aria-label="Biblioteca">' + ICON.back + '<span class="bl">Biblioteca</span></a>' +
        (s.quality_label ? '<span class="q ' + esc(s.source_quality) + '">' + esc(s.quality_label) + '</span>' : '') +
        '<div class="grow"></div>' +
        (s.status === 'ready' ? '<button class="btn sm ghost fav-btn' + (s.favorite ? ' on' : '') + '" id="favtoggle" type="button" aria-pressed="' + !!s.favorite + '" aria-label="Favorito">' + ICON.heartSm + '<span class="bl">' + (s.favorite ? 'Nos favoritos' : 'Favorito') + '</span></button>' : '') +
        '<a class="btn sm ghost" href="' + esc(s.url) + '" target="_blank" rel="noopener" aria-label="Ver vídeo">' + ICON.play + '<span class="bl">Ver vídeo</span></a>' +
        (s.html_file ? '<a class="btn sm ghost" href="' + viewUrl(s.id) + '" target="_blank" rel="noopener" aria-label="Abrir HTML">' + ICON.ext + '<span class="bl">Abrir HTML</span></a>' : '') +
        (STATIC ? '' : '<button class="btn sm ghost" id="del" type="button" aria-label="Apagar">' + ICON.trash + '<span class="bl">Apagar</span></button>') +
        (!STATIC && (s.format === 'json' || s.status === 'error') ? '<button class="btn sm dark" id="regen" type="button" aria-label="Regenerar">' + ICON.redo + '<span class="bl">Regenerar</span></button>' : '') +
        '</div><div class="in" id="confirm" hidden></div></div>';
      var body;
      if (isBusy(s) || s.status === 'error') {
        body = '<div class="shell narrow">' + jobRow(s) + '</div>';
      } else if (s.format === 'html') {
        body = '<iframe class="frame" src="' + viewUrl(s.id) + '" title="' + esc(s.title_pt) + '"></iframe>';
      } else {
        body = '<div class="reader">' + window.renderSummary(s.content, s) + '</div>';
      }
      app.innerHTML = bar + body;
      document.title = (s.title_pt || 'Resumo') + ' · Biblioteca de Resumos';
      bindJobActions(app, function () { viewSummary(id); });
      var favBtn = document.getElementById('favtoggle');
      if (favBtn) favBtn.onclick = function () {
        var on = !s.favorite;
        api('POST', '/api/summaries/' + id + '/favorite', { favorite: on }).then(function () {
          s.favorite = on;
          favBtn.classList.toggle('on', on);
          favBtn.setAttribute('aria-pressed', on);
          favBtn.querySelector('span').textContent = on ? 'Nos favoritos' : 'Favorito';
        }).catch(alertBanner);
      };
      var regen = document.getElementById('regen');
      if (regen) regen.onclick = function () {
        api('POST', '/api/summaries/' + id + '/regenerate').then(function () { viewSummary(id); }).catch(alertBanner);
      };
      if (STATIC) return;
      document.getElementById('del').onclick = function () {
        var c = document.getElementById('confirm');
        c.hidden = false;
        c.innerHTML = '<div class="confirm"><span>Apagar este resumo da biblioteca? Não dá para desfazer.</span>' +
          '<button class="btn sm danger" id="yes" type="button">Apagar</button><button class="btn sm ghost" id="no" type="button">Cancelar</button></div>';
        document.getElementById('no').onclick = function () { c.hidden = true; };
        document.getElementById('yes').onclick = function () {
          api('DELETE', '/api/summaries/' + id).then(function () { location.hash = '#/'; }).catch(alertBanner);
        };
      };
      if (isBusy(s)) poll(function () { viewSummary(id); }, 3000);
    }).catch(function () {
      app.innerHTML = '<div class="shell narrow"><a class="back" href="#/">' + ICON.back + 'Biblioteca</a><div class="empty"><h2>Resumo não encontrado</h2><p>Pode ter sido apagado.</p></div></div>';
    });
  }

  /* ---------------------------------------------------------------- arranque */
  function checkTools() {
    api('GET', '/api/status').then(function (st) {
      var missing = [];
      if (!st.yt_dlp) missing.push('<code>yt-dlp</code>');
      if (!st.claude) missing.push('<code>claude</code> (Claude Code)');
      var b = document.getElementById('banner');
      if (missing.length) {
        b.innerHTML = 'Falta instalar ' + missing.join(' e ') + ' para criar resumos novos. Vê o README.md na pasta da app.';
        b.hidden = false;
      } else b.hidden = true;
    }).catch(function () {});
  }

  // Barra inferior (só aparece no telemóvel)
  function drawTabbar(active) {
    var nav = document.getElementById('tabbar');
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'tabbar';
      nav.setAttribute('aria-label', 'Navegação');
      document.body.appendChild(nav);
    }
    var tabs = [['lib', '#/', ICON.home, 'Biblioteca'], ['new', '#/novo', ICON.plus, 'Novo'], ['fav', '#/favoritos', ICON.heartSm, 'Favoritos']];
    if (STATIC) tabs.splice(1, 1);
    nav.innerHTML = tabs.map(function (t) {
      return '<a href="' + t[1] + '" class="tab tab-' + t[0] + '"' + (t[0] === active ? ' aria-current="page"' : '') + '><span class="ti">' + t[2] + '</span><span>' + t[3] + '</span></a>';
    }).join('');
  }

  function route() {
    stopPoll();
    var t = document.getElementById('toast');
    if (t) t.remove();
    setOpen(null, false);
    document.title = 'Biblioteca de Resumos';
    var h = location.hash || '#/';
    var m = h.match(/^#\/r\/(\d+)/);
    if (m) { drawTabbar(''); window.scrollTo(0, 0); return viewSummary(m[1]); }
    if (h.indexOf('#/novo') === 0 && !STATIC) { drawTabbar('new'); window.scrollTo(0, 0); return viewNew(); }
    var view = h.indexOf('#/favoritos') === 0 ? 'fav' : 'all';
    drawTabbar(view === 'fav' ? 'fav' : 'lib');
    window.scrollTo(0, 0);
    // Entre Biblioteca e Favoritos não é preciso redesenhar a página toda
    if (document.getElementById('filters') && libData.length) {
      if (lib.view !== view) { lib.view = view; filtersChanged(); }
      return;
    }
    lib.view = view;
    viewLibrary();
  }
  window.addEventListener('hashchange', route);
  if (!STATIC) checkTools();
  route();
})();
