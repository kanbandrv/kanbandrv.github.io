/* Capa de conexión: entrega a la app lo que antes daba Claude (datos compartidos, usuario y descargas),
   pero usando Supabase para guardar/sincronizar y su sistema de login por correo y contraseña. */
(function () {
  'use strict';
  var LS_CFG = 'kanban.supabase', LS_PROJ = 'kanban.project';
  var sb = null, session = null, member = null, role = null;
  var multi = false, pid = null, projects = [], projRole = {}, gAdmin = false;   // varios proyectos (si el script SQL 2 está aplicado)
  var cols = {};           // colección -> {rows: Map(id->data), loaded, subs: [], timer}
  var channel = null, pollT = null;

  /* ---------- utilidades ---------- */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rid() { var a = new Uint8Array(10); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.from(a, function (b) { return b.toString(36).padStart(2, '0'); }).join('').slice(0, 16); }
  function fail(error) { var e = new Error((error && error.message) || 'Error de conexión'); e.code = error && error.code; throw e; }
  function getCfg() {
    var c = window.KANBAN_CONFIG || {};
    if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return c;
    try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null') || {}; } catch (_) { return {}; }
  }

  /* ---------- pantalla de acceso ---------- */
  var gateEl = null;
  function gate(html) {
    if (!gateEl) {
      gateEl = el('div', { id: 'gate', role: 'dialog', 'aria-modal': 'true', style: 'position:fixed;inset:0;z-index:9999;background:var(--bg,#f3f3f0);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto' });
      document.body.appendChild(gateEl);
    }
    gateEl.innerHTML = '<style>#gate label{display:flex;flex-direction:column;gap:4px;font-size:13px}#gate .field{width:100%;font-size:16px}</style><div class="card" style="width:min(420px,100%);padding:22px;display:flex;flex-direction:column;gap:12px">' +
      '<div style="display:flex;align-items:center;gap:10px"><div class="logo" aria-hidden="true" style="width:34px;height:34px;border-radius:8px;background:var(--accent,#d4470c);display:grid;place-items:center"><svg viewBox="0 0 24 24" style="width:20px;fill:#fff"><path d="M12 3 2 21h20L12 3zm0 6 5.5 10h-11L12 9z"/></svg></div><b style="font-size:18px">Tablero Kanban de Obra</b></div>' + html + '</div>';
    return gateEl;
  }
  function closeGate() { if (gateEl) { gateEl.remove(); gateEl = null; } }
  function msg(node, text, ok) { var m = node.querySelector('[data-msg]'); if (m) { m.textContent = text || ''; m.style.color = ok ? 'var(--ok,#2f8a55)' : 'var(--danger,#c0341d)'; } }

  function gateSetup() {
    return new Promise(function (resolve) {
      var g = gate('<p style="margin:0">Primera vez: pegue los datos de conexión de su proyecto en Supabase (los encuentra en <b>Project Settings → API</b>).</p>' +
        '<label>Project URL<input class="field" id="g-url" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>' +
        '<label>Clave pública (anon public)<input class="field" id="g-key" placeholder="eyJ..." autocomplete="off"></label>' +
        '<p data-msg style="margin:0;min-height:1.2em"></p><button class="btn pri" id="g-go">Guardar y continuar</button>');
      g.querySelector('#g-go').onclick = function () {
        var u = g.querySelector('#g-url').value.trim(), k = g.querySelector('#g-key').value.trim();
        if (!/^https:\/\/.+\..+/.test(u) || k.length < 20) { msg(g, 'Revise que la URL empiece por https:// y que la clave esté completa.'); return; }
        try { localStorage.setItem(LS_CFG, JSON.stringify({ SUPABASE_URL: u.replace(/\/+$/, ''), SUPABASE_ANON_KEY: k })); } catch (_) { }
        resolve();
      };
    });
  }

  function gateLogin() {
    return new Promise(function (resolve) {
      var mode = 'in';
      function draw(note) {
        var g = gate('<p style="margin:0" class="muted">' + (mode === 'in' ? 'Ingrese con su correo y contraseña.' : 'Cree su cuenta con el mismo correo que el administrador autorizó.') + '</p>' +
          '<label>Correo<input class="field" id="g-mail" type="email" autocomplete="username" inputmode="email"></label>' +
          '<label>Contraseña<input class="field" id="g-pass" type="password" autocomplete="' + (mode === 'in' ? 'current-password' : 'new-password') + '"></label>' +
          '<p data-msg style="margin:0;min-height:1.2em"></p>' +
          '<button class="btn pri" id="g-go">' + (mode === 'in' ? 'Entrar' : 'Crear cuenta') + '</button>' +
          '<button class="btn ghost" id="g-sw">' + (mode === 'in' ? 'Soy nuevo: crear cuenta' : 'Ya tengo cuenta: entrar') + '</button>');
        if (note) msg(g, note.t, note.ok);
        var go = g.querySelector('#g-go');
        function submit() {
          var mail = g.querySelector('#g-mail').value.trim().toLowerCase(), pass = g.querySelector('#g-pass').value;
          if (!mail || !pass) { msg(g, 'Escriba el correo y la contraseña.'); return; }
          if (mode === 'up' && pass.length < 8) { msg(g, 'La contraseña debe tener al menos 8 caracteres.'); return; }
          go.disabled = true; msg(g, 'Conectando…', true);
          var p = mode === 'in' ? sb.auth.signInWithPassword({ email: mail, password: pass }) : sb.auth.signUp({ email: mail, password: pass });
          p.then(function (r) {
            go.disabled = false;
            if (r.error) {
              var t = r.error.message || 'No se pudo ingresar';
              if (/invalid login/i.test(t)) t = 'Correo o contraseña incorrectos.';
              else if (/already registered/i.test(t)) t = 'Ese correo ya tiene cuenta: use «Entrar».';
              else if (/confirm/i.test(t)) t = 'Falta confirmar el correo: revise su bandeja de entrada.';
              msg(g, t); return;
            }
            if (r.data && r.data.session) { session = r.data.session; resolve(); }
            else draw({ t: 'Cuenta creada. Revise su correo para confirmarla y luego entre.', ok: true });
          }).catch(function (e) { go.disabled = false; msg(g, 'Sin conexión con el servidor. Revise internet e intente de nuevo.'); });
        }
        go.onclick = submit;
        g.querySelector('#g-pass').onkeydown = function (e) { if (e.key === 'Enter') submit(); };
        g.querySelector('#g-sw').onclick = function () { mode = mode === 'in' ? 'up' : 'in'; draw(); };
      }
      draw();
    });
  }

  function gateNoAccess(email, why) {
    return new Promise(function (resolve) {
      var g = gate('<p style="margin:0">' + (why || 'El correo <b>' + esc(email) + '</b> todavía no tiene acceso a este tablero.') + '</p><p class="muted" style="margin:0">Pídale al administrador que lo agregue y vuelva a intentar.</p>' +
        '<button class="btn pri" id="g-retry">Volver a intentar</button><button class="btn" id="g-out">Salir</button>');
      g.querySelector('#g-retry').onclick = function () { resolve('retry'); };
      g.querySelector('#g-out').onclick = function () { resolve('out'); };
    });
  }

  /* ---------- arranque y sesión ---------- */
  var readyP = null;
  function ready() {
    if (!readyP) readyP = start().catch(function (e) { readyP = null; throw e; });
    return readyP;
  }
  async function start() {
    while (!(getCfg().SUPABASE_URL)) { await gateSetup(); }
    var c = getCfg();
    if (!window.supabase || !window.supabase.createClient) throw new Error('No se cargó la librería de conexión.');
    sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    var r = await sb.auth.getSession();
    session = r && r.data && r.data.session;
    for (;;) {
      if (!session) { await gateLogin(); }
      var email = ((session.user && session.user.email) || '').toLowerCase();
      var q = await sb.from('members').select('email,name,role').eq('email', email).maybeSingle();
      if (q.error && !/relation|does not exist|schema/i.test(q.error.message || '')) {
        // sesión vencida o problema de red
        if (/jwt|token|auth/i.test(q.error.message || '')) { await sb.auth.signOut(); session = null; continue; }
      }
      if (q.error && /relation|does not exist/i.test(q.error.message || '')) {
        var a0 = await gateNoAccess(email, 'La base de datos aún no está preparada (falta ejecutar el script SQL de la guía).');
        if (a0 === 'out') { await sb.auth.signOut(); session = null; }
        continue;
      }
      if (q.data) {
        member = q.data; role = q.data.role; gAdmin = q.data.role === 'admin';
        var pl = await loadProjects(email);
        if (pl !== 'none') break;
        var a2 = await gateNoAccess(email, 'Su cuenta todavía no tiene ningún proyecto asignado.');
        if (a2 === 'out') { await sb.auth.signOut(); session = null; }
        continue;
      }
      var a = await gateNoAccess(email);
      if (a === 'out') { await sb.auth.signOut(); session = null; }
    }
    closeGate();
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT') location.reload(); });
    startRealtime();
    if (multi) syncProjectName();
  }

  /* ---------- proyectos ---------- */
  async function loadProjects(email) {
    var r = await sb.from('projects').select('id,name,status').order('name');
    if (r.error) {
      // Si aún no se ha ejecutado el script SQL 2, la app sigue funcionando como un solo proyecto
      if (/relation|does not exist|schema cache|projects/i.test(r.error.message || '')) { multi = false; return 'legacy'; }
      throw r.error;
    }
    multi = true; projRole = {};
    var list = r.data || [];
    if (!gAdmin) {
      var m = await sb.from('project_members').select('project_id,role').eq('email', email);
      if (m.error) throw m.error;
      (m.data || []).forEach(function (x) { projRole[x.project_id] = x.role; });
      list = list.filter(function (p) { return projRole[p.id]; });
    }
    projects = list;
    if (!projects.length) return 'none';
    var saved = null; try { saved = localStorage.getItem(LS_PROJ); } catch (_) { }
    var pick = projects.filter(function (p) { return p.id === saved; })[0] ||
      projects.filter(function (p) { return p.status !== 'archived'; })[0] || projects[0];
    pid = pick.id; role = gAdmin ? 'admin' : projRole[pid];
    return 'ok';
  }
  function curProject() { return projects.filter(function (p) { return p.id === pid; })[0] || { id: pid, name: '' }; }
  function switchProject(id) { try { localStorage.setItem(LS_PROJ, id); } catch (_) { } location.reload(); }
  // Si cambian «Nombre del proyecto» en Ajustes, el selector muestra el mismo nombre
  function syncProjectName() {
    mkDoc('cfg', 'main').onSnapshot(function (s) {
      var n = s.exists && s.data().project, p = curProject();
      if (n && p.id && p.name !== n && role === 'admin') {
        p.name = n; sb.from('projects').update({ name: n }).eq('id', p.id).then(function () { drawSwitcher(true); });
      }
    }, function () { });
  }

  /* ---------- datos: caché por colección + tiempo real ---------- */
  function colState(c) { return cols[c] || (cols[c] = { rows: new Map(), loaded: false, subs: [], timer: null }); }
  async function fetchCol(c) {
    var q = sb.from('docs').select('id,data').eq('collection', c);
    if (multi) q = q.eq('project_id', pid);
    var r = await q.range(0, 9999);
    if (r.error) throw r.error;
    var st = colState(c); st.rows = new Map(); (r.data || []).forEach(function (x) { st.rows.set(x.id, x.data || {}); }); st.loaded = true;
    return st;
  }
  function notify(c) {
    var st = colState(c);
    st.subs.slice().forEach(function (s) { try { s.fire(); } catch (e) { console.error(e); } });
  }
  function refresh(c, delay) {
    var st = colState(c);
    if (!st.subs.length) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(function () {
      fetchCol(c).then(function () { notify(c); }).catch(function (e) { st.subs.forEach(function (s) { s.err && s.err(e); }); });
    }, delay == null ? 120 : delay);
  }
  function refreshAll() { Object.keys(cols).forEach(function (c) { refresh(c, 0); }); }
  function startRealtime() {
    try {
      channel = sb.channel('docs-cambios').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
        var row = p.new && p.new.collection ? p.new : p.old;
        if (multi && row && row.project_id && row.project_id !== pid) return;     // cambio de otro proyecto
        if (row && row.collection) refresh(row.collection); else refreshAll();
      }).subscribe();
    } catch (e) { console.warn('Tiempo real no disponible', e); }
    clearInterval(pollT); pollT = setInterval(refreshAll, 30000);          // respaldo si se cae el tiempo real
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(); });
    window.addEventListener('online', refreshAll);
  }

  function splitPath(p) { p = String(p).replace(/^\/+|\/+$/g, ''); var i = p.lastIndexOf('/'); return { col: p.slice(0, i), id: p.slice(i + 1) }; }
  function docSnap(id, d) { return { id: id, exists: d !== undefined, data: function () { return d === undefined ? undefined : JSON.parse(JSON.stringify(d)); } }; }
  function mkSub(c, build, cb, eb) {
    var st = colState(c), s = { err: eb, fire: function () { cb(build(st)); } };
    st.subs.push(s);
    (st.loaded ? Promise.resolve(st) : fetchCol(c)).then(function () { s.fire(); }).catch(function (e) { if (eb) eb(e); });
    return function () { var i = st.subs.indexOf(s); if (i >= 0) st.subs.splice(i, 1); };
  }
  function mkDoc(col, id) {
    return {
      id: id, path: col + '/' + id,
      get: async function () { var st = await fetchCol(col); return docSnap(id, st.rows.get(id)); },
      set: async function (data) {
        var row = { collection: col, id: id, data: data, updated_at: new Date().toISOString() }; if (multi) row.project_id = pid;
        var r = await sb.from('docs').upsert(row); if (r.error) fail(r.error);
        var st = colState(col); st.rows.set(id, JSON.parse(JSON.stringify(data))); notify(col); refresh(col, 400);
      },
      update: async function (patch) {
        var args = { p_collection: col, p_id: id, p_patch: patch }; if (multi) args.p_project = pid;
        var r = await sb.rpc('merge_doc', args); if (r.error) fail(r.error);
        refresh(col, 0);
      },
      delete: async function () {
        var dq = sb.from('docs').delete().eq('collection', col).eq('id', id); if (multi) dq = dq.eq('project_id', pid);
        var r = await dq; if (r.error) fail(r.error);
        var st = colState(col); st.rows.delete(id); notify(col); refresh(col, 400);
      },
      onSnapshot: function (cb, eb) { return mkSub(col, function (st) { return docSnap(id, st.rows.get(id)); }, cb, eb); }
    };
  }
  function mkCol(col) {
    return {
      path: col,
      doc: function (id) { return mkDoc(col, id || rid()); },
      add: async function (data) { var d = mkDoc(col, rid()); await d.set(data); return d; },
      get: async function () { var st = await fetchCol(col); return colSnap(st); },
      onSnapshot: function (cb, eb) { return mkSub(col, colSnap, cb, eb); }
    };
  }
  function colSnap(st) {
    var docs = []; st.rows.forEach(function (d, id) { docs.push(docSnap(id, d)); });
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
  }
  var db = { doc: function (p) { var s = splitPath(p); return mkDoc(s.col, s.id); }, collection: function (p) { return mkCol(p); } };

  /* ---------- usuario ---------- */
  var members = {
    list: async function () { var r = await sb.from('members').select('email,name,role').order('email'); if (r.error) fail(r.error); return r.data || []; },
    save: async function (m) { var r = await sb.from('members').upsert({ email: String(m.email).trim().toLowerCase(), name: m.name || null, role: m.role || 'editor' }); if (r.error) fail(r.error); },
    remove: async function (email) { var r = await sb.from('members').delete().eq('email', String(email).toLowerCase()); if (r.error) fail(r.error); }
  };
  var user = {
    can: function (n) { return n === 'data.write' ? (role === 'admin' || role === 'editor') : null; },
    canEdit: function () { return role === 'admin'; },
    isOwner: function () { return role === 'admin'; },
    id: async function () { return session.user.id; },
    me: async function () { var mail = (session.user.email || ''); return { id: session.user.id, name: (member && member.name) || mail.split('@')[0], email: mail, avatarUrl: '' }; },
    profiles: async function (ids) { var o = {}; (ids || []).forEach(function (i) { o[i] = { name: i === session.user.id ? (member && member.name) || '' : '' }; }); return o; },
    role: function () { return role; },
    members: members,
    signOut: async function () { await sb.auth.signOut(); location.reload(); }
  };

  /* ---------- descargas ---------- */
  var MIME = { json: 'application/json', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8', txt: 'text/plain;charset=utf-8' };
  var downloads = {
    save: async function (req) {
      var ext = (String(req.filename).split('.').pop() || '').toLowerCase();
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data], { type: MIME[ext] || 'application/octet-stream' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = req.filename; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { status: 'saved' };
    }
  };

  window.claude = {
    use: async function (name) {
      if (name === 'downloads') return downloads;
      if (name === 'db' || name === 'user') { await ready(); return name === 'db' ? db : user; }
      return null;
    }
  };

  /* ---------- extras de interfaz: botón Salir y gestión de accesos (sin tocar la app) ---------- */
  function inject() {
    var me = document.getElementById('me');
    if (me && member && !me.querySelector('[data-out]')) {
      var b = el('button', { class: 'btn sm ghost', 'data-out': '1', style: 'color:inherit;border-color:rgba(255,255,255,.35)' }, 'Salir');
      b.onclick = function () { user.signOut(); }; me.appendChild(b);
    }
    if (multi) drawSwitcher();
    var grid = document.querySelector('#main .grid');
    if (grid && role === 'admin' && document.querySelector('[data-cfg="project"]') && !document.getElementById('mb')) {
      var card = multi
        ? el('div', { class: 'card', id: 'mb' }, '<h2>Accesos a este proyecto</h2><p class="muted" style="margin:0 0 8px">Estas personas solo ven <b>este</b> proyecto. «Editor» modifica tareas y comités; «Lector» solo consulta; «Administrador del proyecto» además gestiona estos accesos. El «Administrador general» entra a todos los proyectos.</p><div id="mb-body">Cargando…</div>')
        : el('div', { class: 'card', id: 'mb' }, '<h2>Accesos a la herramienta</h2><p class="muted" style="margin:0 0 8px">Solo las personas de esta lista pueden entrar. «Editor» modifica tareas y comités; «Lector» solo consulta; «Administrador» además gestiona accesos.</p><div id="mb-body">Cargando…</div>');
      grid.appendChild(card); multi ? drawProjectMembers() : drawMembers();
    }
  }

  /* ---------- selector de proyectos (cabecera) ---------- */
  function drawSwitcher(force) {
    var top = document.querySelector('header.top'), me = document.getElementById('me');
    if (!top || !me) return;
    var box = document.getElementById('psw');
    var vis = projects.filter(function (p) { return p.status !== 'archived' || p.id === pid; });
    if (vis.length < 2 && !gAdmin) { if (box) box.remove(); return; }
    if (box && !force) return;
    if (!box) { box = el('div', { id: 'psw' }); top.insertBefore(box, me); }
    if (!document.getElementById('psw-css')) {
      document.head.appendChild(el('style', { id: 'psw-css' }, '#psw{display:flex;gap:6px;align-items:center;margin-right:8px}#psw select{max-width:min(44vw,260px);font:inherit;font-size:13px;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:inherit}#psw select option{color:#111;background:#fff}#psw button{font-size:13px}' +
        '#pm-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto}#pm-ov .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0;border-bottom:1px solid var(--line,#ddd)}#pm-ov .row .field{flex:1;min-width:160px}'));
    }
    box.innerHTML = '<select aria-label="Proyecto" id="psw-sel">' + vis.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pid ? ' selected' : '') + '>' + esc(p.name || p.id) + (p.status === 'archived' ? ' (archivado)' : '') + '</option>'; }).join('') + '</select>' +
      (gAdmin ? '<button class="btn sm ghost" id="psw-mng" style="color:inherit;border-color:rgba(255,255,255,.35)" title="Crear o administrar proyectos">Proyectos</button>' : '');
    box.querySelector('#psw-sel').onchange = function () { switchProject(this.value); };
    var mg = box.querySelector('#psw-mng'); if (mg) mg.onclick = openManager;
  }

  /* ---------- ventana «Proyectos» (solo administrador general) ---------- */
  var delAsk = null;
  async function reloadProjects() {
    var r = await sb.from('projects').select('id,name,status').order('name'); if (r.error) fail(r.error);
    projects = r.data || [];
  }
  function openManager() {
    var ov = document.getElementById('pm-ov'); if (ov) ov.remove();
    ov = el('div', { id: 'pm-ov', role: 'dialog', 'aria-modal': 'true' });
    document.body.appendChild(ov);
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    drawManager(ov, '');
  }
  function drawManager(ov, note) {
    ov.innerHTML = '<div class="card" style="width:min(680px,100%);padding:18px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">Proyectos</h2><button class="btn sm" data-x="close">Cerrar</button></div>' +
      '<p class="muted" style="margin:6px 0 10px">Cada proyecto tiene sus propias tareas, comités, equipo y accesos. Archivar lo oculta del selector sin borrar nada.</p>' +
      projects.map(function (p) {
        var cur = p.id === pid, arch = p.status === 'archived';
        return '<div class="row" data-p="' + esc(p.id) + '"><input class="field" data-name value="' + esc(p.name) + '" aria-label="Nombre del proyecto">' +
          '<button class="btn sm" data-x="rename">Guardar nombre</button>' +
          (cur ? '<span class="pill">Abierto</span>' : '<button class="btn sm" data-x="open">Abrir</button>') +
          '<button class="btn sm ghost" data-x="arch">' + (arch ? 'Restaurar' : 'Archivar') + '</button>' +
          '<button class="btn sm ghost" data-x="del" style="color:var(--danger,#c0341d)">Borrar</button>' +
          (delAsk === p.id ? '<div style="flex-basis:100%;background:var(--bg,#f3f3f0);border-radius:8px;padding:8px"><b>Se borrarán para siempre las tareas, comités y equipo de «' + esc(p.name) + '».</b> Descargue antes su respaldo (Equipo y ajustes). Para confirmar, escriba el nombre exacto:<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><input class="field" data-confirm style="flex:1;min-width:160px"><button class="btn sm" data-x="delgo" style="background:var(--danger,#c0341d);color:#fff">Borrar definitivamente</button><button class="btn sm ghost" data-x="delno">Cancelar</button></div></div>' : '') + '</div>';
      }).join('') +
      '<h3 style="margin:14px 0 6px">Crear proyecto nuevo</h3><div class="row" style="border:0"><input class="field" id="pm-new" placeholder="Nombre del proyecto"><button class="btn pri" data-x="create">Crear</button></div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="pm-copy" checked> Copiar el equipo y los ajustes (disciplinas, límites WIP) del proyecto «' + esc(curProject().name) + '»</label>' +
      '<p data-pmsg style="margin:8px 0 0;min-height:1.2em;color:var(--danger,#c0341d)">' + esc(note) + '</p></div>';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.onkeydown = function (e) { if (e.key === 'Escape') ov.remove(); };
    var bad = function (e) { drawManager(ov, (e && e.message) || 'No se pudo completar la acción.'); };
    ov.querySelectorAll('[data-x]').forEach(function (b) {
      b.onclick = async function () {
        var row = b.closest('[data-p]'), id = row && row.dataset.p, act = b.dataset.x;
        try {
          if (act === 'close') { ov.remove(); return; }
          if (act === 'open') { switchProject(id); return; }
          if (act === 'rename') {
            var n = row.querySelector('[data-name]').value.trim(); if (!n) { drawManager(ov, 'El nombre no puede quedar vacío.'); return; }
            var u = await sb.from('projects').update({ name: n }).eq('id', id); if (u.error) fail(u.error);
            var m = await sb.rpc('merge_doc', { p_project: id, p_collection: 'cfg', p_id: 'main', p_patch: { project: n } }); if (m.error) fail(m.error);
            await reloadProjects(); drawSwitcher(true); drawManager(ov, ''); if (id === pid) refresh('cfg', 0); return;
          }
          if (act === 'arch') {
            var p = projects.filter(function (x) { return x.id === id; })[0], to = p.status === 'archived' ? 'active' : 'archived';
            var u2 = await sb.from('projects').update({ status: to }).eq('id', id); if (u2.error) fail(u2.error);
            await reloadProjects();
            if (to === 'archived' && id === pid) { var o = projects.filter(function (x) { return x.status !== 'archived'; })[0]; if (o) { switchProject(o.id); return; } }
            drawSwitcher(true); drawManager(ov, ''); return;
          }
          if (act === 'del') { delAsk = id; drawManager(ov, ''); return; }
          if (act === 'delno') { delAsk = null; drawManager(ov, ''); return; }
          if (act === 'delgo') {
            var pn = projects.filter(function (x) { return x.id === id; })[0].name;
            if (row.querySelector('[data-confirm]').value.trim() !== pn.trim()) { drawManager(ov, 'El nombre no coincide: no se borró nada.'); return; }
            var d = await sb.rpc('delete_project', { p_id: id }); if (d.error) fail(d.error);
            delAsk = null; await reloadProjects();
            if (id === pid) { var o2 = projects.filter(function (x) { return x.status !== 'archived'; })[0] || projects[0]; if (o2) { switchProject(o2.id); return; } }
            drawSwitcher(true); drawManager(ov, ''); return;
          }
          if (act === 'create') {
            var nm = ov.querySelector('#pm-new').value.trim(); if (!nm) { drawManager(ov, 'Escriba el nombre del nuevo proyecto.'); return; }
            b.disabled = true;
            var c = await sb.rpc('create_project', { p_name: nm, p_copy_from: ov.querySelector('#pm-copy').checked ? pid : null }); if (c.error) fail(c.error);
            switchProject(c.data); return;
          }
        } catch (e) { bad(e); }
      };
    });
  }

  /* ---------- accesos por proyecto ---------- */
  var PROLES = { admin: 'Administrador del proyecto', editor: 'Editor', viewer: 'Lector' };
  async function drawProjectMembers() {
    var box = document.getElementById('mb-body'); if (!box) return;
    var myMail = (session.user.email || '').toLowerCase();
    function say(t) { var m = box.querySelector('#mb-msg'); if (m) m.textContent = t || ''; }
    async function call(fn, args) { var r = await sb.rpc(fn, args); if (r.error) fail(r.error); }
    try {
      var r = await sb.rpc('list_project_members', { p_project: pid }); if (r.error) fail(r.error);
      var list = r.data || [];
      box.innerHTML = '<div class="tw"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Permiso</th><th></th></tr></thead><tbody>' +
        list.map(function (m) {
          var me = m.email === myMail;
          var perm = m.is_general ? 'Administrador general' : '<select class="sel" data-role="' + esc(m.email) + '" data-nm="' + esc(m.name || '') + '"' + '>' + Object.keys(PROLES).map(function (k) { return '<option value="' + k + '"' + (k === m.role ? ' selected' : '') + '>' + PROLES[k] + '</option>'; }).join('') + '</select>';
          var act = me ? '' : m.is_general ? (gAdmin ? '<button class="btn sm ghost" data-ungen="' + esc(m.email) + '">Quitar rol general</button>' : '') : '<button class="btn sm ghost" data-rm="' + esc(m.email) + '">Quitar</button>';
          return '<tr><td>' + esc(m.email) + '</td><td>' + esc(m.name || '') + '</td><td>' + perm + '</td><td>' + act + '</td></tr>';
        }).join('') +
        '</tbody></table></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input class="field" id="mb-mail" type="email" placeholder="correo@empresa.com" style="flex:2;min-width:180px"><input class="field" id="mb-name" placeholder="Nombre" style="flex:1;min-width:120px"><select class="sel" id="mb-role"><option value="editor">Editor</option><option value="viewer">Lector</option><option value="admin">Administrador del proyecto</option>' + (gAdmin ? '<option value="general">Administrador general (todos los proyectos)</option>' : '') + '</select><button class="btn pri" id="mb-add">Autorizar</button></div><p id="mb-msg" class="muted" style="margin:6px 0 0"></p>';
      var again = function (p) { return p.then(drawProjectMembers).catch(function (e) { say(e.message); }); };
      box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { again(call('remove_project_member', { p_project: pid, p_email: b.dataset.rm })); }; });
      box.querySelectorAll('[data-ungen]').forEach(function (b) { b.onclick = function () { again(call('set_general_admin', { p_email: b.dataset.ungen, p_name: '', p_on: false })); }; });
      box.querySelectorAll('[data-role]').forEach(function (s) { s.onchange = function () { again(call('add_project_member', { p_project: pid, p_email: s.dataset.role, p_name: s.dataset.nm, p_role: s.value })); }; });
      box.querySelector('#mb-add').onclick = function () {
        var mail = box.querySelector('#mb-mail').value.trim(), nm = box.querySelector('#mb-name').value.trim(), rl = box.querySelector('#mb-role').value;
        if (!/^\S+@\S+\.\S+$/.test(mail)) { say('Escriba un correo válido.'); return; }
        again(rl === 'general' ? call('set_general_admin', { p_email: mail, p_name: nm, p_on: true }) : call('add_project_member', { p_project: pid, p_email: mail, p_name: nm, p_role: rl }));
      };
    } catch (e) { box.textContent = 'No se pudo cargar la lista: ' + e.message; }
  }
  var ROLES = { admin: 'Administrador', editor: 'Editor', viewer: 'Lector' };
  async function drawMembers() {
    var box = document.getElementById('mb-body'); if (!box) return;
    try {
      var list = await members.list();
      box.innerHTML = '<div class="tw"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Permiso</th><th></th></tr></thead><tbody>' +
        list.map(function (m) { return '<tr><td>' + esc(m.email) + '</td><td>' + esc(m.name || '') + '</td><td>' + ROLES[m.role] + '</td><td>' + (m.email === (session.user.email || '').toLowerCase() ? '' : '<button class="btn sm ghost" data-rm="' + esc(m.email) + '">Quitar</button>') + '</td></tr>'; }).join('') +
        '</tbody></table></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><input class="field" id="mb-mail" type="email" placeholder="correo@empresa.com" style="flex:2;min-width:180px"><input class="field" id="mb-name" placeholder="Nombre" style="flex:1;min-width:120px"><select class="sel" id="mb-role"><option value="editor">Editor</option><option value="viewer">Lector</option><option value="admin">Administrador</option></select><button class="btn pri" id="mb-add">Autorizar</button></div><p id="mb-msg" class="muted" style="margin:6px 0 0"></p>';
      box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { members.remove(b.dataset.rm).then(drawMembers).catch(function (e) { box.querySelector('#mb-msg').textContent = e.message; }); }; });
      box.querySelector('#mb-add').onclick = function () {
        var m = box.querySelector('#mb-mail').value.trim();
        if (!/^\S+@\S+\.\S+$/.test(m)) { box.querySelector('#mb-msg').textContent = 'Escriba un correo válido.'; return; }
        members.save({ email: m, name: box.querySelector('#mb-name').value.trim(), role: box.querySelector('#mb-role').value }).then(drawMembers).catch(function (e) { box.querySelector('#mb-msg').textContent = e.message; });
      };
    } catch (e) { box.textContent = 'No se pudo cargar la lista: ' + e.message; }
  }
  new MutationObserver(function () { if (member) inject(); }).observe(document.documentElement, { childList: true, subtree: true });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  }
})();

