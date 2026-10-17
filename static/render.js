/* Renderiza um resumo (JSON) em HTML. Usado pela app e pelos ficheiros HTML independentes. */
(function (global) {
  var QUALITY = {
    full_transcript: 'a transcrição completa do episódio',
    partial_transcript: 'parte da transcrição do episódio',
    secondary_summaries: 'transcrições e resumos publicados do episódio',
    metadata_only: 'a descrição e os capítulos do vídeo'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function list(a) { return Array.isArray(a) ? a : []; }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? u : '#'; }

  function equation(items) {
    items = list(items);
    if (!items.length) return '';
    var out = [];
    items.forEach(function (it, i) {
      var last = i === items.length - 1;
      if (i > 0) out.push('<div class="op" aria-hidden="true">' + (last ? '=' : '×') + '</div>');
      var cls = last ? 'c' : (i % 2 === 0 ? 'a' : 'b');
      out.push('<div class="chip ' + cls + '"><b>' + esc(it.label) + '</b><span>' + esc(it.detail) + '</span></div>');
    });
    return '<div class="equation">' + out.join('') + '</div>';
  }

  function shift(s) {
    if (!s || (!list(s.before).length && !list(s.after).length)) return '';
    var li = function (a) { return list(a).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join(''); };
    return '<section><h2>A mudança de perspetiva</h2><div class="shift">' +
      '<div class="col old"><h3>' + esc(s.before_title || 'Antes') + '</h3><ul>' + li(s.before) + '</ul></div>' +
      '<div class="arrow" aria-hidden="true">→</div>' +
      '<div class="col new"><h3>' + esc(s.after_title || 'Depois') + '</h3><ul>' + li(s.after) + '</ul></div>' +
      '</div></section>';
  }

  function highlight(h) {
    if (!h || !list(h.items).length) return '';
    var items = list(h.items);
    var body = '';
    if (h.type === 'bars') {
      var max = Math.max.apply(null, items.map(function (i) { return Math.abs(Number(i.value) || 0); })) || 1;
      body = '<div class="panel"><div class="bars">' + items.map(function (i, idx) {
        var v = Math.abs(Number(i.value) || 0);
        var pct = Math.max(2, Math.round((v / max) * 78));
        var top = v === max;
        var label = i.display || (String(i.value) + (h.unit ? ' ' + h.unit : ''));
        return '<div class="lbl">' + esc(i.label) + '</div><div class="track"><div class="bar' + (top ? ' top' : '') +
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
    return '<section><h2>' + esc(h.title || 'Em destaque') + '</h2>' +
      (h.subtitle ? '<p class="sub">' + esc(h.subtitle) + '</p>' : '') + body + '</section>';
  }

  function renderSummary(c, meta) {
    c = c || {}; meta = meta || {};
    var guests = list(c.guests).length ? list(c.guests) : list(meta.guests);
    var eyebrow = c.eyebrow || ['Podcast', meta.channel, guests.join(' e ')].filter(Boolean).join(' · ');
    var ideas = list(c.key_ideas).map(function (i) {
      return '<div class="card"><div class="tag">' + esc(i.tag) + '</div><h3>' + esc(i.title) + '</h3><p>' + esc(i.text) + '</p></div>';
    }).join('');
    var steps = list(c.steps).map(function (s) {
      return '<div class="step"><div><b>' + esc(s.title) + '</b><span>' + esc(s.text) + '</span></div></div>';
    }).join('');
    var debate = list(c.debate).length ? '<section><h2>Pontos em discussão</h2><div class="debate"><h3>Outros pontos de vista</h3><ul>' +
      list(c.debate).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div></section>' : '';
    var evidence = c.evidence_note ? '<section><h2>Quão sólida é a evidência</h2><div class="evidence"><p>' + esc(c.evidence_note) + '</p></div></section>' : '';
    var sources = list(c.sources).filter(function (s) { return s && s.url; });
    var quality = QUALITY[c.source_quality || meta.source_quality] || 'as fontes indicadas';
    var footer = '<footer><div>Resumo baseado em ' + esc(quality) + '. Os números são os citados no episódio e nas fontes.</div>' +
      (sources.length ? '<div class="links">' + sources.map(function (s) {
        return '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a>';
      }).join('') + '</div>' : '') + '</footer>';

    return '<article class="sum">' +
      '<header><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(c.title_pt || meta.title_pt || meta.title_original) + '</h1>' +
      (c.lede ? '<p class="lede">' + esc(c.lede) + '</p>' : '') + equation(c.equation) + '</header>' +
      shift(c.shift) + highlight(c.highlight) +
      (ideas ? '<section><h2>As ideias-chave</h2><div class="grid">' + ideas + '</div></section>' : '') +
      (c.quote ? '<blockquote>' + esc(c.quote) + '</blockquote>' : '') +
      (steps ? '<section><h2>Para aplicar</h2><div class="steps">' + steps + '</div></section>' : '') +
      debate + evidence + footer + '</article>';
  }

  global.renderSummary = renderSummary;
  global.escapeHtml = esc;
})(typeof window !== 'undefined' ? window : this);
