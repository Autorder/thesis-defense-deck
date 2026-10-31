/* shared by index.html (the deck) and script.html (the iPad follower) — one copy of
   each: how a slide is found in a deck, how its script is drawn, and the ntfy.sh relay */
(function(){
  "use strict";

  /* where slide `id` sits in deck `deck`; -1 when it isn't there */
  function slideAt(deck, id){
    var d = window.DECKS && DECKS[deck];
    if (!d || !id) return -1;
    for (var i = 0; i < d.slides.length; i++) if (d.slides[i].id === id) return i;
    return -1;
  }

  /* a slide's page, versioned by the build so GitHub Pages never serves a stale one */
  function slideURL(s){ return s.path + (window.BUILD ? "?v=" + BUILD : ""); }

  /* slides are drawn at 1920×1080 and scaled to the width they are given */
  function fit(f, width){ f.style.transform = "scale(" + (width / 1920) + ")"; }

  /* safety net: if a slide's text runs past the bottom (a wider font on another computer,
     a long line), shrink that slide's content just enough to fit — never clip it */
  function guard(f){
    var d; try { d = f.contentDocument; } catch (e) { return; }   /* file:// — nothing to do */
    var pad = d && d.querySelector(".pad");
    if (!pad) return;
    function measure(){
      pad.style.transform = "";
      var max = 0, w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT), n, r = d.createRange();
      while ((n = w.nextNode())){
        if (!n.textContent.trim() || !n.parentElement || n.parentElement.closest("script,style")) continue;
        r.selectNodeContents(n);
        var rs = r.getClientRects();
        for (var i = 0; i < rs.length; i++) if (rs[i].height > 0 && rs[i].bottom > max) max = rs[i].bottom;
      }
      /* painted boxes too (cards, strips, images) — their padding/border can pass the edge while the text still fits */
      pad.querySelectorAll("*").forEach(function(e){
        var cs = d.defaultView.getComputedStyle(e);
        if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") return;
        var painted = e.tagName === "IMG" || e.tagName.toLowerCase() === "svg" || cs.backgroundImage !== "none" ||
                      (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || parseFloat(cs.borderBottomWidth) > 0;
        if (!painted) return;
        var b = e.getBoundingClientRect();
        if (b.height > 0 && b.bottom + 8 > max) max = b.bottom + 8;
      });
      var limit = 1080 - 22;
      if (max > limit){
        pad.style.transformOrigin = "top center";
        pad.style.transform = "scale(" + (limit / max).toFixed(4) + ")";
      }
    }
    (d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve()).then(measure);
  }

  /* o.read: the reviewers' copy — lines only. o.qaOpen: false folds the prepared answers. */
  function scriptHTML(sc, o){
    o = o || {};
    var html = "";
    if (sc){
      html += '<details class="sc" open><summary>מה אני אומר בשקף הזה' +
              '<span class="n">' + sc.lines.length + " שורות</span></summary>" +
              '<div class="scbody">';
      /* red is for what changes what he says. sc.notes (provenance, verification) stay in
         scripts_source.json for the builder and are not shown — Avi doesn't use them. */
      if (sc.warn && !o.read) html += '<p class="warn"><b>שים לב:</b> ' + sc.warn + "</p>";
      html += '<div class="lines">' +
              sc.lines.map(function(l){ return "<p>" + l + "</p>"; }).join("") +
              "</div></div></details>";
      if (sc.qa && sc.qa.length && !o.read){
        html += '<details class="sc qa"' + (o.qaOpen === false ? "" : " open") + '><summary>שאלות צפויות של הבוחנים' +
                '<span class="n">' + sc.qa.length + " שאלות</span></summary>" +
                '<div class="scbody">' +
                sc.qa.map(function(x){
                  return '<div class="qitem"><p class="q">' + x.q + '</p><p class="a">' + x.a + "</p>" +
                         (x.go ? '<span class="go">' + x.go + "</span>" : "") + "</div>";
                }).join("") + "</div></details>";
      }
    } else {
      html += '<details class="sc"><summary>אין עדיין סקריפט לשקף הזה' +
              '<span class="n">חסר</span></summary></details>';
    }
    return html;
  }

  /* ---------- the relay: the deck tells ntfy.sh which slide is up, the iPad listens.
     The topic is the shared secret, so it should be long and random. ---------- */
  var NTFY = "https://ntfy.sh/";
  function topicURL(code){ return NTFY + encodeURIComponent(code); }

  /* fire-and-forget, after the slide settles: holding → through ten slides is one message,
     not ten (ntfy.sh allows 60 at once, then one per 5 s, 250 a day) */
  var last = "", wait = null, retry = null;
  function announce(code, msg){
    var body = JSON.stringify(msg);
    if (body === last) return;
    last = body;
    clearTimeout(wait); clearTimeout(retry);
    wait = setTimeout(function(){ post(code, body, 1); }, 450);
  }
  function post(code, body, tries){
    if (!window.fetch || body !== last) return;
    fetch(topicURL(code), { method: "POST", body: body, keepalive: true }).then(function(r){
      if (!r.ok) throw 0;
    }).catch(function(){
      if (tries > 0) retry = setTimeout(function(){ post(code, body, tries - 1); }, 5000);
      else if (body === last) last = "";
    });
  }

  /* the way back: the iPad's remote buttons publish to <code>-ctl, which only the deck reads */
  function ctlTopic(code){ return code + "-ctl"; }
  /* msg: {cmd:"next"} / {cmd:"prev"} / {cmd:"row", row:<a chooser row>} */
  function command(code, msg){
    if (!window.fetch) return Promise.reject();
    return fetch(topicURL(ctlTopic(code)), { method: "POST", body: JSON.stringify(msg) })
      .then(function(r){ if (!r.ok) throw 0; });
  }

  /* one subscription to a topic, kept alive: o.since ("latest" replays the last message),
     onMsg(payload, ntfyMessage) for each message, onState(true/false) as the line comes and goes.
     ntfy sends a keepalive every ~45 s, so a minute and a half of silence means a dead line. */
  function listen(topic, o){
    var es = null, seen = 0, again = null;
    function state(on){ if (o.onState) o.onState(on); }
    function connect(){
      clearTimeout(again);
      if (es) es.close();
      state(false);
      es = new EventSource(topicURL(topic) + "/sse" + (o.since ? "?since=" + o.since : ""));
      seen = Date.now();
      function alive(){ seen = Date.now(); state(true); }
      es.onopen = alive;
      es.addEventListener("open", alive);
      es.addEventListener("keepalive", alive);
      es.onmessage = function(ev){
        alive();
        var d, m;
        try { d = JSON.parse(ev.data); m = JSON.parse(d.message); } catch (e) { return; }
        if (d.event === "message") o.onMsg(m, d);
      };
      es.onerror = function(){
        state(false);
        if (es.readyState === 2) again = setTimeout(connect, 3000);   /* closed for good: we retry */
      };
    }
    connect();
    setInterval(function(){ if (Date.now() - seen > 100000) connect(); }, 15000);
    document.addEventListener("visibilitychange", function(){
      if (document.visibilityState === "visible" && (!es || es.readyState !== 1)) connect();
    });
  }

  window.ScriptView = { slideAt: slideAt, slideURL: slideURL, fit: fit, guard: guard, html: scriptHTML, topicURL: topicURL, announce: announce,
                        ctlTopic: ctlTopic, command: command, listen: listen };
})();
