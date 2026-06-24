/* Shared client helper: WebSocket connection, server-clock sync, countdowns. */
(function (global) {
  'use strict';

  function GameSocket(role) {
    this.role = role;
    this.handlers = {};        // type -> [cb]
    this.stateCb = null;
    this.clockOffset = 0;      // serverNow - clientNow
    this.lastState = null;
    this._connect();
  }

  GameSocket.prototype._connect = function () {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?role=${encodeURIComponent(this.role)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    const self = this;

    ws.onopen = function () {
      self._setDot(true);
      if (self.onOpen) self.onOpen();
    };
    ws.onclose = function () {
      self._setDot(false);
      setTimeout(function () { self._connect(); }, 1200); // auto-reconnect
    };
    ws.onmessage = function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'state' || msg.type === 'needAuth') {
        if (typeof msg.now === 'number') self.clockOffset = msg.now - Date.now();
        self.lastState = msg;
        if (self.stateCb) self.stateCb(msg);
      }
      const list = self.handlers[msg.type] || [];
      list.forEach(function (cb) { cb(msg); });
    };
  };

  GameSocket.prototype.send = function (obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  };

  GameSocket.prototype.on = function (type, cb) {
    (this.handlers[type] = this.handlers[type] || []).push(cb);
    return this;
  };

  GameSocket.prototype.onState = function (cb) { this.stateCb = cb; return this; };

  // Remaining seconds for a server timer, using the synced clock.
  GameSocket.prototype.remaining = function (timer) {
    if (!timer || !timer.endsAt) return 0;
    const serverNow = Date.now() + this.clockOffset;
    return Math.max(0, (timer.endsAt - serverNow) / 1000);
  };

  GameSocket.prototype._setDot = function (on) {
    document.querySelectorAll('.conn-dot').forEach(function (d) { d.classList.toggle('on', on); });
  };

  // Drive an element's text with a live countdown from a server timer.
  // Re-reads gs.lastState.timer each tick so phase changes are picked up.
  function bindCountdown(gs, el, opts) {
    opts = opts || {};
    function tick() {
      const st = gs.lastState;
      const timer = st && st.timer;
      let secs = 0;
      if (timer && (!opts.phase || timer.phase === opts.phase)) secs = gs.remaining(timer);
      el.textContent = Math.ceil(secs);
      el.classList.toggle('warn', secs <= 10 && secs > 5);
      el.classList.toggle('danger', secs <= 5);
      requestAnimationFrame(tick);
    }
    tick();
  }

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function download(filename, text) {
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
    a.download = filename;
    a.click();
  }

  global.Pictionary = { GameSocket: GameSocket, bindCountdown: bindCountdown, el: el, esc: esc, download: download };
})(window);
