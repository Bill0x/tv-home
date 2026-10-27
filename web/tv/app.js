// TV Home app. Runs in the TV's browser engine (Chromium 69 on Tizen 5.5):
// no optional chaining, `??` or other post-2018 syntax.
(function () {
  var CFG = window.TV_CONFIG || {};
  var SERVER = CFG.server || "";
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8 };

  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------- toast

  var toastTimer;
  function toast(text) {
    var t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  // ---------------------------------------------------------------- tabs

  var current = "home";
  function showTab(name) {
    current = name;
    ["home", "draw", "ask"].forEach(function (n) { $("page-" + n).hidden = n !== name; });
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === name);
    $("topclock").style.visibility = name === "home" ? "hidden" : "visible";
    if (name === "draw") {
      fitBoard();
      focus($("boardbox"));
    }
    if (name === "ask") focus($("askinput"));
  }

  // ---------------------------------------------------------------- focus navigation

  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function focusables() {
    var all = document.querySelectorAll("[data-nav]");
    var out = [];
    for (var i = 0; i < all.length; i++) if (visible(all[i])) out.push(all[i]);
    return out;
  }

  function focus(el) {
    if (!el) return;
    var prev = document.querySelector(".focused");
    if (prev) prev.classList.remove("focused");
    el.classList.add("focused");
    el.focus();
  }

  // Move to the nearest element in the pressed direction.
  function move(dir) {
    var from = document.activeElement;
    var list = focusables();
    if (list.indexOf(from) < 0) return focus(list[0]);
    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === from) return;
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay;
      var along, across;
      if (dir === KEY.LEFT) { along = -dx; across = dy; }
      else if (dir === KEY.RIGHT) { along = dx; across = dy; }
      else if (dir === KEY.UP) { along = -dy; across = dx; }
      else { along = dy; across = dx; }
      if (along <= 1) return;
      var score = along + Math.abs(across) * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focus(best);
  }

  // ---------------------------------------------------------------- home

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function tick() {
    var d = new Date(), h = d.getHours();
    var time = pad(h) + ":" + pad(d.getMinutes());
    $("bigclock").textContent = time;
    $("topclock").textContent = time;
    $("date").textContent = DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
    $("greeting").textContent = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  function buildApps() {
    var row = $("apptiles");
    (CFG.apps || []).forEach(function (app) {
      var b = document.createElement("button");
      b.className = "tile";
      b.setAttribute("data-nav", "");
      b.style.background = "linear-gradient(135deg, " + app.color + ", #111827)";
      b.innerHTML = '<span class="tile-name"></span>';
      b.firstChild.textContent = app.name;
      b.addEventListener("click", function () { launch(app); });
      row.appendChild(b);
    });
  }

  function launch(app) {
    if (!window.tizen) return toast(app.name + " opens when this runs on the TV");
    tizen.application.launch(app.id, function () {}, function () {
      toast(app.name + " isn't installed on this TV");
    });
  }

  var WEATHER_CODES = [
    [0, "☀️", "Clear"], [3, "⛅", "Partly cloudy"], [48, "🌫️", "Fog"], [57, "🌦️", "Drizzle"],
    [67, "🌧️", "Rain"], [77, "❄️", "Snow"], [82, "🌧️", "Showers"], [86, "🌨️", "Snow showers"], [99, "⛈️", "Thunderstorm"],
  ];

  function loadWeather() {
    var w = CFG.weather;
    if (!w) return;
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + w.lat + "&longitude=" + w.lon +
      "&current=temperature_2m,weather_code";
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      var c = data.current, desc = WEATHER_CODES[WEATHER_CODES.length - 1];
      for (var i = 0; i < WEATHER_CODES.length; i++) {
        if (c.weather_code <= WEATHER_CODES[i][0]) { desc = WEATHER_CODES[i]; break; }
      }
      $("weather").textContent = desc[1] + "  " + Math.round(c.temperature_2m) + "°  " + desc[2] + " in " + w.name;
      $("weather").hidden = false;
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- draw

  var board, cursor = { x: 0.5, y: 0.5, active: false, pen: false };

  function fitBoard() {
    var wrap = document.querySelector(".boardwrap"), box = $("boardbox");
    var W = wrap.clientWidth, H = wrap.clientHeight;
    var w = Math.min(W, H * 16 / 9);
    box.style.width = w + "px";
    box.style.height = (w * 9 / 16) + "px";
    if (board) board.resize();
  }

  function buildDrawBar() {
    var sw = $("swatches");
    Board.COLORS.forEach(function (color, i) {
      var b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " selected" : "");
      b.setAttribute("data-nav", "");
      b.style.background = color;
      b.addEventListener("click", function () {
        board.color = color;
        selectIn(sw, b);
        updateCursor();
      });
      sw.appendChild(b);
    });
    var sizes = document.querySelectorAll(".size");
    for (var i = 0; i < sizes.length; i++) {
      (function (b) {
        if (b.getAttribute("data-size") === "0.006") b.classList.add("selected");
        b.addEventListener("click", function () {
          board.width = parseFloat(b.getAttribute("data-size"));
          selectIn(b.parentNode, b);
        });
      })(sizes[i]);
    }
    $("clearboard").addEventListener("click", function () {
      board.clear();
      toast("Board cleared");
    });
  }

  function selectIn(parent, el) {
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle("selected", kids[i] === el);
  }

  function updateCursor() {
    var c = $("cursor");
    c.hidden = !cursor.active;
    c.style.left = cursor.x * 100 + "%";
    c.style.top = cursor.y * 100 + "%";
    c.style.color = board.color;
    c.classList.toggle("pen", cursor.pen);
    $("boardbox").classList.toggle("drawing", cursor.active);
    $("boardtip").textContent = !cursor.active
      ? "Press Enter to draw with the arrow keys"
      : cursor.pen
        ? "Drawing — Enter to lift the pen, Back to finish"
        : "Move with arrows — Enter to put the pen down, Back to finish";
  }

  function boardKey(code, repeat) {
    if (code === KEY.ENTER) {
      cursor.pen = !cursor.pen;
      if (cursor.pen) board.begin(cursor.x, cursor.y); else board.end();
    } else if (code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE) {
      if (cursor.pen) board.end();
      cursor.pen = false;
      cursor.active = false;
    } else {
      var step = repeat ? 0.012 : 0.006;
      if (code === KEY.LEFT) cursor.x -= step;
      if (code === KEY.RIGHT) cursor.x += step;
      if (code === KEY.UP) cursor.y -= step * 16 / 9;
      if (code === KEY.DOWN) cursor.y += step * 16 / 9;
      cursor.x = Math.min(1, Math.max(0, cursor.x));
      cursor.y = Math.min(1, Math.max(0, cursor.y));
      if (cursor.pen) board.extend(cursor.x, cursor.y);
    }
    updateCursor();
  }

  function startBoard() {
    board = new Board($("board"), SERVER);
    board.attachPointer();
    board.onstatus = function (ok) {
      $("conn").textContent = ok ? "" : "Can't reach the Mac — is server.py running?";
    };
    board.connect();
    buildDrawBar();
    $("boardbox").addEventListener("click", function () { $("boardtip").hidden = true; });
    fetch(SERVER + "/api/status").then(function (r) { return r.json(); }).then(function (s) {
      $("drawhint").innerHTML = "Draw from your phone:<br><b>http://" + s.ip + ":" + s.port + "/draw</b>";
      if (!s.ai) addMsg("err", "The assistant is off: the Mac's server needs an Anthropic API key.");
    }).catch(function () {});
  }

  // ---------------------------------------------------------------- ask

  var asking = false;

  function addMsg(kind, text) {
    var m = document.createElement("div");
    m.className = "msg " + kind;
    m.textContent = text;
    $("chat").appendChild(m);
    $("chat").scrollTop = $("chat").scrollHeight;
    return m;
  }

  function ask(text) {
    if (asking) return;
    asking = true;
    addMsg("me", text);
    var wait = addMsg("bot wait", "Thinking…");
    fetch(SERVER + "/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    }).then(function (r) { return r.json(); }).then(function (res) {
      wait.remove();
      if (res.error) addMsg("err", res.error); else addMsg("bot", res.reply);
    }).catch(function () {
      wait.remove();
      addMsg("err", "Can't reach the Mac — is server.py running?");
    }).then(function () { asking = false; });
  }

  function startAsk() {
    $("askform").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("askinput"), text = input.value.trim();
      if (!text) return;
      input.value = "";
      ask(text);
    });
    $("newchat").addEventListener("click", function () {
      fetch(SERVER + "/api/assistant/reset", { method: "POST" }).catch(function () {});
      var chat = $("chat");
      while (chat.children.length > 1) chat.removeChild(chat.lastChild);
      focus($("askinput"));
    });
  }

  // ---------------------------------------------------------------- keys

  document.addEventListener("keydown", function (e) {
    var code = e.keyCode, el = document.activeElement;
    var inInput = el && el.tagName === "INPUT";

    if (cursor.active && el === $("boardbox")) {
      e.preventDefault();
      return boardKey(code, e.repeat);
    }

    if (code === KEY.BACK || code === KEY.ESC) {
      e.preventDefault();
      if (current !== "home") {
        showTab("home");
        focus(document.querySelector('.tab[data-tab="home"]'));
      } else if (window.tizen) {
        tizen.application.getCurrentApplication().hide();
      }
      return;
    }

    if (code >= 37 && code <= 40) {
      // Let left/right move the text cursor inside the question box.
      if (inInput && (code === KEY.LEFT || code === KEY.RIGHT) && el.value) return;
      e.preventDefault();
      move(code);
      return;
    }

    if (code === KEY.ENTER && el === $("boardbox")) {
      e.preventDefault();
      cursor.active = true;
      $("boardtip").hidden = false;
      updateCursor();
    }
  });

  // Mouse/pointer clicks also move focus, so the highlight follows the mouse.
  document.addEventListener("mousedown", function (e) {
    var t = e.target.closest ? e.target.closest("[data-nav]") : null;
    if (t) focus(t);
  });

  // ---------------------------------------------------------------- start

  function init() {
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
      })(tabs[i]);
    }
    var gotos = document.querySelectorAll("[data-goto]");
    for (var j = 0; j < gotos.length; j++) {
      (function (g) {
        g.addEventListener("click", function () { showTab(g.getAttribute("data-goto")); });
      })(gotos[j]);
    }
    buildApps();
    tick();
    setInterval(tick, 1000);
    loadWeather();
    startBoard();
    startAsk();
    window.addEventListener("resize", function () { if (current === "draw") fitBoard(); });
    showTab("home");
    focus(document.querySelector("#apptiles .tile") || focusables()[0]);
  }

  init();
})();
