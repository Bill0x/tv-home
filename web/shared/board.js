// Shared drawing board, used by the TV app and the phone page.
// Coordinates are normalized (0..1) so every screen shows the same picture.
// Written for the TV's older browser engine: no optional chaining or `??`.
(function () {
  function Board(canvas, server) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.server = server || "";
    this.events = [];
    this.color = "#ffffff";
    this.width = 0.006;
    this.stroke = null; // the stroke being drawn on this screen
    this.onstatus = function () {};
    var self = this;
    window.addEventListener("resize", function () { self.resize(); });
    this.resize();
    setInterval(function () { self.flush(); }, 60);
  }

  Board.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.redraw();
  };

  Board.prototype.redraw = function () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (var i = 0; i < this.events.length; i++) this.drawSeg(this.events[i]);
  };

  Board.prototype.drawSeg = function (seg) {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height, p = seg.points;
    ctx.strokeStyle = ctx.fillStyle = seg.color;
    ctx.lineWidth = seg.width * w;
    ctx.lineCap = ctx.lineJoin = "round";
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0] * w, p[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(p[0][0] * w, p[0][1] * h);
    for (var i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * w, p[i][1] * h);
    ctx.stroke();
  };

  Board.prototype.connect = function () {
    var self = this;
    var es = new EventSource(this.server + "/api/board/stream");
    es.onopen = function () { self.onstatus(true); };
    es.onerror = function () { self.onstatus(false); }; // EventSource retries on its own
    es.onmessage = function (msg) {
      var ev = JSON.parse(msg.data);
      if (ev.type === "snapshot") {
        self.events = ev.events;
        self.redraw();
      } else if (ev.type === "seg") {
        self.events.push(ev);
        self.drawSeg(ev);
      } else if (ev.type === "clear") {
        self.events = [];
        self.redraw();
      }
    };
  };

  // --- drawing from this screen -------------------------------------------

  Board.prototype.begin = function (x, y) {
    this.stroke = {
      sid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      last: null,
      pending: [[x, y]],
    };
    this.drawSeg({ color: this.color, width: this.width, points: [[x, y]] });
  };

  Board.prototype.extend = function (x, y) {
    var s = this.stroke;
    if (!s) return;
    var prev = s.pending.length ? s.pending[s.pending.length - 1] : s.last;
    s.pending.push([x, y]);
    if (prev) this.drawSeg({ color: this.color, width: this.width, points: [prev, [x, y]] });
  };

  Board.prototype.end = function () {
    this.flush();
    this.stroke = null;
  };

  // Send what was drawn since the last flush, starting from the previous
  // point so the pieces join up on other screens.
  Board.prototype.flush = function () {
    var s = this.stroke;
    if (!s || !s.pending.length) return;
    var points = s.last ? [s.last].concat(s.pending) : s.pending;
    s.last = s.pending[s.pending.length - 1];
    s.pending = [];
    this.post("/api/board/segment", { sid: s.sid, color: this.color, width: this.width, points: points });
  };

  Board.prototype.clear = function () {
    this.post("/api/board/clear", {});
  };

  Board.prototype.post = function (path, body) {
    return fetch(this.server + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(function () {});
  };

  // Mouse and touch drawing directly on the canvas.
  Board.prototype.attachPointer = function () {
    var self = this, c = this.canvas, down = false;
    function pos(e) {
      var r = c.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      ];
    }
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", function (e) {
      down = true;
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId);
      var p = pos(e);
      self.begin(p[0], p[1]);
      e.preventDefault();
    });
    c.addEventListener("pointermove", function (e) {
      if (!down) return;
      var p = pos(e);
      self.extend(p[0], p[1]);
      e.preventDefault();
    });
    function up() {
      if (!down) return;
      down = false;
      self.end();
    }
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
  };

  Board.COLORS = ["#ffffff", "#ff5a5f", "#ffb400", "#34d399", "#38bdf8", "#a78bfa", "#f472b6", "#111827"];

  window.Board = Board;
})();
