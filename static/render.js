/* Renderiza um resumo (JSON) em HTML. Usado pela app e pelos ficheiros HTML independentes.
   Organização: cabeçalho com tempo de leitura, capítulos, "Em 30 segundos", fórmula, o que muda,
   ideias numeradas, destaque com números, passos para marcar, contexto e fontes. */
(function (global) {
  var QUALITY = {
    full_transcript: 'a transcrição completa do episódio',
    partial_transcript: 'parte da transcrição do episódio',
    secondary_summaries: 'transcrições e resumos publicados do episódio',
    metadata_only: 'a descrição e os capítulos do vídeo'
  };
  var QUALITY_SHORT = {
    full_transcript: 'Transcrição completa',
    partial_transcript: 'Transcrição parcial',
    secondary_summaries: 'Resumos de terceiros',
    metadata_only: 'Só descrição'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function list(a) { return Array.isArray(a) ? a : []; }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? u : '#'; }

  // Tempo de leitura estimado: todo o texto do resumo a ~200 palavras por minuto
  function readMinutes(c) {
    var words = 0;
    (function walk(v) {
      if (typeof v === 'string') words += v.split(/\s+/).filter(Boolean).length;
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (k !== 'sources') walk(v[k]); });
    })(c);
    return Math.max(1, Math.round(words / 200));
  }

  function formula(items) {
    items = list(items);
    if (!items.length) return '';
    return '<div class="formula" role="list" aria-label="A fórmula do episódio">' + items.map(function (it, i) {
      var last = i === items.length - 1;
      var op = i === 0 ? '' : (last ? '=' : '×');
      return '<div class="frow' + (last ? ' res' : (i % 2 ? ' b' : '')) + '" role="listitem"><span class="op" aria-hidden="true">' + op + '</span>' +
        '<b>' + esc(it.label) + '</b><span class="fd">' + esc(it.detail) + '</span></div>';
    }).join('') + '</div>';
  }

  function shift(s) {
    if (!s) return '';
    var before = list(s.before), after = list(s.after);
    var n = Math.max(before.length, after.length);
    if (!n) return '';
    var rows = '';
    for (var i = 0; i < n; i++) {
      rows += '<div class="pair"><span class="o">' + esc(before[i] || '') + '</span><span class="ar" aria-label="passa a">→</span><span class="nw">' + esc(after[i] || '') + '</span></div>';
    }
    return '<div class="shift"><h3>A mudança de perspetiva</h3>' +
      '<div class="pair ph" aria-hidden="true"><span>' + esc(s.before_title || 'Antes') + '</span><span></span><span>' + esc(s.after_title || 'Depois') + '</span></div>' +
      rows + '</div>';
  }

  function highlight(h) {
    var items = list(h.items);
    var body = '';
    if (h.type === 'bars') {
      var max = Math.max.apply(null, items.map(function (i) { return Math.abs(Number(i.value) || 0); })) || 1;
      body = '<div class="panel"><div class="bars">' + items.map(function (i) {
        var v = Math.abs(Number(i.value) || 0);
        var pct = Math.max(2, Math.round((v / max) * 78));
        var top = v === max;
        var label = i.display || (String(i.value) + (h.unit ? ' ' + h.unit : ''));
        return '<div class="lbl">' + esc(i.label) + '</div><div class="track"><div class="bfill' + (top ? ' top' : '') +
          '" style="width:' + pct + '%"></div><div class="val">' + esc(label) + '</div></div>';
      }).join('') + '</div>' + (h.note ? '<p class="note">' + esc(h.note) + '</p>' : '') + '</div>';
    } else if (h.type === 'flow') {
      body = '<div class="panel"><div class="flow">' + items.map(function (i, idx) {
        var cls = idx === 0 ? ' first' : idx === items.length - 1 ? ' last' : '';
        return (idx ? '<div class="to" aria-hidden="true">→</div>' : '') +
          '<div class="node' + cls + '"><b>' + esc(i.label) + '</b>' + (i.detail ? '<span>' + esc(i.detail) + '</span>' : '') + '</div>';
      }).join('') + '</div>' + (h.note ? '<p class="note">' + esc(h.note) + '</p>' : '') + '</div>';
    } else {
      body = '<div class="trio">' + items.slice(0, 3).map(function (i) {
        return '<div class="box"><div class="big">' + esc(i.display || i.value || '') + '</div><h3>' + esc(i.label) +
          '</h3><p>' + esc(i.detail) + '</p></div>';
      }).join('') + '</div>' + (h.note ? '<p class="note">' + esc(h.note) + '</p>' : '');
    }
    return (h.subtitle ? '<p class="sub">' + esc(h.subtitle) + '</p>' : '') + body;
  }

  function section(id, n, title, inner, extra) {
    return '<section class="chap" id="' + id + '"><div class="sh">' + (n ? '<span class="n">' + n + '</span>' : '') +
      '<h2>' + esc(title) + '</h2>' + (extra || '') + '</div>' + inner + '</section>';
  }

  function renderSummary(c, meta) {
    c = c || {}; meta = meta || {};
    var guests = list(c.guests).length ? list(c.guests) : list(meta.guests);
    var eyebrow = c.eyebrow || ['Podcast', meta.channel, guests.join(' e ')].filter(Boolean).join(' · ');
    var q = c.source_quality || meta.source_quality;
    var ideasL = list(c.key_ideas), stepsL = list(c.steps);
    var h = c.highlight && list(c.highlight.items).length ? c.highlight : null;
    var hasContext = list(c.debate).length || c.evidence_note;
    var sources = list(c.sources).filter(function (s) { return s && s.url; });

    // Capítulos: só os que existem neste resumo
    var caps = [['essencial', 'Essencial']];
    if (ideasL.length) caps.push(['ideias', 'Ideias']);
    if (h) caps.push(['destaque', h.type === 'bars' ? 'Em números' : 'Destaque']);
    if (stepsL.length) caps.push(['pratica', 'Na prática']);
    if (hasContext) caps.push(['contexto', 'Contexto']);
    caps.push(['fontes', 'Fontes']);
    var num = function (id) {
      var i = caps.map(function (x) { return x[0]; }).indexOf(id);
      return i > 0 ? ('0' + (i + 1)).slice(-2) : '';
    };

    var pills = '<span class="pill">≈ ' + readMinutes(c) + ' min de leitura</span>' +
      (ideasL.length || stepsL.length ? '<span class="pill">' + [ideasL.length ? ideasL.length + ' ideias' : '', stepsL.length ? stepsL.length + ' passos' : ''].filter(Boolean).join(' · ') + '</span>' : '') +
      (QUALITY_SHORT[q] ? '<span class="pill q ' + esc(q) + '">' + QUALITY_SHORT[q] + '</span>' : '');

    var essencial = (c.lede ? '<div class="tldr"><b>Em 30 segundos</b>' + esc(c.lede) + '</div>' : '') + formula(c.equation) + shift(c.shift);

    var ideas = ideasL.map(function (i, k) {
      return '<div class="idea"><span class="k" aria-hidden="true">' + (k + 1) + '</span><div><div class="tag">' + esc(i.tag) + '</div><h3>' + esc(i.title) + '</h3><p>' + esc(i.text) + '</p></div></div>';
    }).join('');

    var steps = stepsL.map(function (s, k) {
      return '<label class="step"><input type="checkbox" data-step="' + k + '"><span><b>' + esc(s.title) + '</b><span>' + esc(s.text) + '</span></span></label>';
    }).join('');

    var context = (c.evidence_note ? '<div class="evidence"><h3>Quão sólida é a evidência</h3><p>' + esc(c.evidence_note) + '</p></div>' : '') +
      (list(c.debate).length ? '<div class="debate"><h3>Outros pontos de vista</h3><ul>' +
        list(c.debate).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>' : '');

    var fontes = '<div class="src"><p>Resumo baseado em ' + esc(QUALITY[q] || 'as fontes indicadas') + '. Os números são os citados no episódio e nas fontes.</p>' +
      (sources.length ? '<div class="links">' + sources.map(function (s) {
        return '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a>';
      }).join('') + '</div>' : '') + '</div>';

    return '<article class="sum">' +
      '<header class="hero"><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(c.title_pt || meta.title_pt || meta.title_original) + '</h1>' +
      '<div class="pills">' + pills + '</div></header>' +
      '<nav class="caps" aria-label="Capítulos">' + caps.map(function (x, i) {
        return '<a href="#' + x[0] + '" data-cap="' + x[0] + '"' + (i === 0 ? ' class="on" aria-current="true"' : '') + '>' + x[1] + '</a>';
      }).join('') + '</nav>' +
      section('essencial', '', 'Essencial', essencial) +
      (ideas ? section('ideias', num('ideias'), ideasL.length + ' ideias-chave', '<div class="ideas">' + ideas + '</div>') : '') +
      (c.quote ? '<blockquote>' + esc(c.quote) + '</blockquote>' : '') +
      (h ? section('destaque', num('destaque'), h.title || 'Em destaque', highlight(h)) : '') +
      (steps ? section('pratica', num('pratica'), 'Para aplicar', '<div class="steps">' + steps + '</div>', '<span class="done" aria-live="polite"></span>') : '') +
      (hasContext ? section('contexto', num('contexto'), 'Contexto', context) : '') +
      section('fontes', num('fontes'), 'Fontes', fontes) +
      '</article>';
  }

  global.renderSummary = renderSummary;
  global.escapeHtml = esc;
})(typeof window !== 'undefined' ? window : this);
