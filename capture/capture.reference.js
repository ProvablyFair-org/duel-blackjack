// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

if (window._bjkill) window._bjkill();

(function () {
  'use strict';

  var INSTANCE = Date.now();
  window._bjkill = function () { INSTANCE = -1; };

  // ── Phase config ────────────────────────────────────────────────────────
  // Total: 3300 + 1000 + 500 + 500 + 200 + 500 = 6,000 hands
  var PHASES = [
    { key: 'A', name: 'Basic strategy',      total: 3300, mainAmt: '0.01', ppAmt: '0.01', t3Amt: '0.01', strategy: 'basic',      customSeeds: false },
    { key: 'B', name: 'Aggressive hit 16+',  total: 1000, mainAmt: '0.01', ppAmt: '0.01', t3Amt: '0.01', strategy: 'aggressive',  customSeeds: false },
    { key: 'C', name: 'Split/double priority', total: 500, mainAmt: '0.01', ppAmt: '0.01', t3Amt: '0.01', strategy: 'splitforce', customSeeds: false },
    { key: 'D', name: 'Custom client seeds',  total: 500,  mainAmt: '0.01', ppAmt: '0.01', t3Amt: '0.01', strategy: 'basic',      customSeeds: true, seedCount: 10, handsPerSeed: 50 },
    { key: 'E', name: 'Bet-size invariance',  total: 200,  mainAmt: '10',   ppAmt: null,   t3Amt: null,   strategy: 'basic',      customSeeds: false },
    { key: 'F', name: 'Multi-split focus',    total: 500,  mainAmt: '0.01', ppAmt: '0.01', t3Amt: '0.01', strategy: 'splitforce', customSeeds: false },
  ];

  var BETS_PER_EPOCH = 50;
  var BET_DELAY = 800;
  var ACTION_DELAY = 400;
  var MAX_ERRORS = 8;
  var DB_NAME = 'bj_capture';

  // ── Basic Strategy (infinite deck, total-dependent) ─────────────────────

  var RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':10,'Q':10,'K':10,'A':11 };

  function handVal(cards) {
    var total = 0, aces = 0;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].rank;
      if (r === 'A') { aces++; total += 1; }
      else total += RANK_VAL[r] || parseInt(r);
    }
    var soft = (aces > 0 && total + 10 <= 21) ? total + 10 : total;
    return { hard: total, best: soft <= 21 ? soft : total, isSoft: aces > 0 && total + 10 <= 21 && total + 10 === soft };
  }

  function dealerUp(bj) {
    // Dealer upcard = cursor 3 = dealer.hands[0].cards[1] (after face-down is revealed it's still index 1)
    // But during play, cards[0] is upcard (face_down=false), cards[1] is hole (face_down=true)
    var dc = bj.dealer.hands[0].cards;
    for (var i = 0; i < dc.length; i++) { if (!dc[i].face_down && dc[i].rank) return dc[i]; }
    return dc[0]; // fallback
  }

  function normalizeRank(r) { return (r === 'J' || r === 'Q' || r === 'K') ? '10' : r; }

  // Strategy decision: returns 'hit', 'stand', 'double', 'split'
  function basicDecision(playerHand, dealerUpcard, actions, phase) {
    var avail = {};
    for (var i = 0; i < actions.length; i++) avail[actions[i]] = true;

    // Insurance — always decline
    if (avail.insurance || avail.no_insurance) return 'no_insurance';

    var cards = playerHand.cards.filter(function(c) { return !c.face_down; });
    var hv = handVal(cards);
    var du = normalizeRank(dealerUpcard.rank);

    // Phase B: aggressive — hit to 16+
    if (phase === 'B') {
      if (avail.split) return 'split'; // still split pairs in Phase B for coverage
      if (avail.hit && hv.best < 17) return 'hit';
      if (avail.stand) return 'stand';
      if (avail.hit) return 'hit'; // fallback
    }

    // Phase C/F: split-force — always split when available, always double when available
    if (phase === 'C' || phase === 'F') {
      if (avail.split) return 'split';
      if (avail.double) return 'double';
      if (avail.hit && hv.best < 17) return 'hit';
      if (avail.stand) return 'stand';
    }

    // Default: basic strategy (phases A, D, E)
    // Pairs
    if (cards.length === 2 && avail.split) {
      var r1 = normalizeRank(cards[0].rank);
      var r2 = normalizeRank(cards[1].rank);
      if (r1 === r2) {
        var shouldSplit = false;
        if (r1 === 'A' || r1 === '8') shouldSplit = true;
        else if (r1 === '9' && !['7','10','A'].includes(du)) shouldSplit = true;
        else if (r1 === '7' && ['2','3','4','5','6','7'].includes(du)) shouldSplit = true;
        else if (r1 === '6' && ['2','3','4','5','6'].includes(du)) shouldSplit = true;
        else if (r1 === '4' && ['5','6'].includes(du)) shouldSplit = true;
        else if ((r1 === '3' || r1 === '2') && ['2','3','4','5','6','7'].includes(du)) shouldSplit = true;
        if (shouldSplit) return 'split';
      }
    }

    // Soft hands
    if (hv.isSoft) {
      if (hv.best >= 19) return avail.stand ? 'stand' : 'hit';
      if (hv.best === 18) {
        if (['3','4','5','6'].includes(du) && avail.double) return 'double';
        if (['3','4','5','6'].includes(du) && !avail.double) return avail.stand ? 'stand' : 'hit'; // Ds fallback: stand
        if (['2','7','8'].includes(du)) return avail.stand ? 'stand' : 'hit';
        return avail.hit ? 'hit' : 'stand';
      }
      if (hv.best === 17 && ['3','4','5','6'].includes(du) && avail.double) return 'double';
      if (hv.best === 16 && ['4','5','6'].includes(du) && avail.double) return 'double';
      // Soft 13-15: always hit (infinite deck)
      return avail.hit ? 'hit' : 'stand';
    }

    // Hard hands
    if (hv.best >= 17) return avail.stand ? 'stand' : 'hit';
    if (hv.best >= 13 && ['2','3','4','5','6'].includes(du)) return avail.stand ? 'stand' : 'hit';
    if (hv.best === 12 && ['4','5','6'].includes(du)) return avail.stand ? 'stand' : 'hit';
    if (hv.best === 11 && du !== 'A' && avail.double) return 'double';
    if (hv.best === 10 && !['10','A'].includes(du) && avail.double) return 'double';
    if (hv.best === 9 && ['3','4','5','6'].includes(du) && avail.double) return 'double';
    return avail.hit ? 'hit' : 'stand';
  }

  // ── IndexedDB ───────────────────────────────────────────────────────────
  var db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('bets')) d.createObjectStore('bets', { autoIncrement: true });
        if (!d.objectStoreNames.contains('seeds')) d.createObjectStore('seeds', { autoIncrement: true });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(store, value, key) { return new Promise(function (ok, fail) { var tx = db.transaction(store, 'readwrite'); var r = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).add(value); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbGetAll(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbGet(store, key) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).get(key); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }
  function dbClear(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readwrite').objectStore(store).clear(); r.onsuccess = function () { ok(); }; r.onerror = function () { fail(r.error); }; }); }
  function dbCount(store) { return new Promise(function (ok, fail) { var r = db.transaction(store, 'readonly').objectStore(store).count(); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); }; }); }

  // ── State ───────────────────────────────────────────────────────────────
  var meta = {};
  var paused = false;
  var betCount = 0;
  var seedCount = 0;

  function freshMeta() {
    var counts = {};
    for (var i = 0; i < PHASES.length; i++) counts[PHASES[i].key] = 0;
    return {
      phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
      token: null, tokenAt: 0, errors: 0, running: false,
      lastNextHash: null, createdAt: new Date().toISOString(),
      lastTxId: null,
      activeServerSeedHashed: null, activeClientSeed: null,
      phaseBetCounts: counts, customSeedIdx: 0,
    };
  }

  function saveMeta() { return dbPut('meta', meta, 'state'); }

  // ── Logging ─────────────────────────────────────────────────────────────
  function log(msg) { console.log('%c[bj] ' + msg, 'color:#5c9eff'); updatePanel(); }
  function warn(msg) { console.warn('%c[bj] ' + msg, 'color:#ffb74d'); updatePanel(); }
  function good(msg) { console.log('%c[bj] ' + msg, 'color:#81c784'); updatePanel(); }
  function bad(msg) { console.error('%c[bj] ' + msg, 'color:#ff4444; font-weight:bold'); updatePanel(); }

  // ── Panel ───────────────────────────────────────────────────────────────
  function buildPanel() {
    var old = document.getElementById('cap-panel'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'cap-panel';
    Object.assign(d.style, { position:'fixed', bottom:'16px', right:'16px', zIndex:'99999', background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'8px', padding:'12px 16px', fontFamily:'monospace', fontSize:'11px', color:'#b8cfe0', minWidth:'300px', boxShadow:'0 4px 24px rgba(0,0,0,.7)', cursor:'move', userSelect:'none' });
    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) { if (e.target.tagName === 'BUTTON') return; dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop; });
    document.addEventListener('mousemove', function (e) { if (!dragging) return; d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px'; d.style.right = 'auto'; d.style.bottom = 'auto'; });
    document.addEventListener('mouseup', function () { dragging = false; });

    var title = document.createElement('div'); title.textContent = 'BLACKJACK CAPTURE';
    Object.assign(title.style, { color:'#5c9eff', fontWeight:'700', fontSize:'13px' }); d.appendChild(title);
    var st = document.createElement('div'); st.id = 'cap-status'; Object.assign(st.style, { margin:'6px 0', color:'#4d6880', fontSize:'10px' }); d.appendChild(st);

    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var row = document.createElement('div'); Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });
      var lbl = document.createElement('span'); lbl.textContent = ph.key; Object.assign(lbl.style, { width:'22px', color:'#4d6880', fontWeight:'700', fontSize:'10px' });
      var barOuter = document.createElement('div'); Object.assign(barOuter.style, { flex:'1', height:'8px', background:'#161e28', borderRadius:'4px', overflow:'hidden' });
      var fill = document.createElement('div'); fill.id = 'cap-bar-' + ph.key; Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'4px', transition:'width .3s' }); barOuter.appendChild(fill);
      var ct = document.createElement('span'); ct.id = 'cap-ct-' + ph.key; ct.textContent = '0/' + ph.total; Object.assign(ct.style, { width:'80px', textAlign:'right', fontSize:'9px', color:'#4d6880' });
      row.appendChild(lbl); row.appendChild(barOuter); row.appendChild(ct); d.appendChild(row);
    }

    var seedLine = document.createElement('div'); seedLine.id = 'cap-seeds'; Object.assign(seedLine.style, { margin:'6px 0 4px', fontSize:'10px', color:'#4d6880' }); d.appendChild(seedLine);
    var btnRow = document.createElement('div'); Object.assign(btnRow.style, { display:'flex', gap:'4px', marginTop:'8px' });
    function mkBtn(text, color, fn) { var b = document.createElement('button'); b.textContent = text; Object.assign(b.style, { flex:'1', padding:'5px 0', background:'#161e28', border:'1px solid #1e2d3d', color: color, borderRadius:'3px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px', fontWeight:'700' }); b.addEventListener('click', fn); return b; }
    btnRow.appendChild(mkBtn('GO', '#2dff82', function () { pub.go(); }));
    btnRow.appendChild(mkBtn('PAUSE', '#ffcc44', function () { pub.pause(); }));
    btnRow.appendChild(mkBtn('SAVE', '#33ccff', function () { pub.save(); }));
    d.appendChild(btnRow); document.body.appendChild(d);
  }

  function updatePanel() {
    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi]; var n = meta.phaseBetCounts ? (meta.phaseBetCounts[ph.key] || 0) : 0;
      var bar = document.getElementById('cap-bar-' + ph.key); var ct = document.getElementById('cap-ct-' + ph.key);
      if (bar) { bar.style.width = Math.min(100, n / ph.total * 100) + '%'; bar.style.background = n >= ph.total ? '#33ccff' : '#2dff82'; }
      if (ct) ct.textContent = n + '/' + ph.total;
    }
    var st = document.getElementById('cap-status');
    if (st) { st.textContent = (paused ? 'PAUSED' : (meta.running ? 'RUNNING' : 'IDLE')) + ' | hands: ' + betCount + ' | seeds: ' + seedCount + (meta.errors > 0 ? ' | err:' + meta.errors : ''); st.style.color = meta.running && !paused ? '#2dff82' : '#4d6880'; }
    var sl = document.getElementById('cap-seeds');
    if (sl) sl.textContent = 'seeds: ' + seedCount + ' | epoch: ' + (meta.epochBets || 0) + '/' + BETS_PER_EPOCH;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  var HEADERS = {
    'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
    'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
    'x-env-class': localStorage.getItem('env_class') || 'blue',
  };

  function api(method, path, body) {
    var opts = { method: method, credentials: 'include', headers: HEADERS };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.success === false) throw new Error((j.message || JSON.stringify(j).slice(0, 200)).slice(0, 200));
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    return api('POST', '/api/v2/user/security/token', { uuid: localStorage.getItem('security:uuid'), code: '0000', type: 'standard' })
      .then(function (r) { meta.token = r.token || r; meta.tokenAt = Date.now(); return meta.token; });
  }
  function ensureToken() { return (Date.now() - meta.tokenAt > 300000) ? refreshToken() : Promise.resolve(meta.token); }
  function getActiveSeed() { return api('GET', '/api/v2/client-seed'); }
  function getTransaction(txId) { return api('GET', '/api/v2/user/transactions/' + txId); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = 'pf_'; for (var i = 0; i < 13; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function generateAuditSeed(idx) {
    return 'pfaudit_bj_seed' + String(idx).padStart(2, '0');
  }

  // Clear any stuck active blackjack hand (e.g., from page refresh mid-hand)
  function clearStuckHand() {
    return api('GET', '/api/v2/blackjack').then(function (data) {
      if (!data || !data.id || data.status === 5) return; // no active hand or already complete
      var handId = data.id;
      var bj = data.blackjack;
      if (!bj) return;

      var actions = bj.available_actions || [];
      log('clearing stuck hand ' + handId + ' actions: ' + actions.join(','));

      // Handle insurance first
      if (actions.includes('insurance') || actions.includes('no_insurance')) {
        return api('POST', '/api/v2/blackjack/' + handId + '/insurance', { accept: false }).then(function () {
          return clearStuckHand(); // recurse to handle next action
        });
      }
      // Stand to finish
      if (actions.includes('stand')) {
        var activeIdx = bj.player.active_hand_index || 0;
        var hand = bj.player.hands[activeIdx];
        return api('POST', '/api/v2/blackjack/' + handId + '/stand', {
          active_hand_index: activeIdx, active_hand_size: hand.cards.length, active_hand_value: hand.value, hand_amount: bj.player.hands.length
        }).then(function (resp) {
          // Check if there are more hands to play (split)
          var nextBJ = resp.blackjackNext ? resp.blackjackNext.blackjack : (resp.blackjack || null);
          if (nextBJ && nextBJ.available_actions && nextBJ.available_actions.length > 0) {
            return clearStuckHand(); // recurse for remaining split hands
          }
        });
      }
    }).catch(function (e) { log('no stuck hand or clear failed: ' + e.message); });
  }

  function rotateSeed(customSeed) {
    var clientSeed = customSeed || generateClientSeed();
    return ensureToken().then(function (token) {
      log('rotate: clientSeed=' + clientSeed.slice(0, 16) + '...');
      return api('POST', '/api/v2/client-seed/rotate', { client_seed: clientSeed, security_token: token });
    });
  }

  // ── Play one blackjack hand ─────────────────────────────────────────────

  function playHand(phase, token) {
    var ph = PHASES.find(function (p) { return p.key === phase; });

    // Build deal request
    var dealBody = {
      amount: ph.mainAmt,
      balance_type: 105,
      instant: false,
      security_token: token,
    };
    if (ph.ppAmt && ph.t3Amt) {
      dealBody.side_bets = [
        { type: 'side_perfect_pairs', amount: ph.ppAmt },
        { type: 'side_21_plus_3', amount: ph.t3Amt },
      ];
    }

    var record = { phase: phase, actions: [], deal: null, final: null, actionResponses: [] };

    return api('POST', '/api/v2/blackjack', dealBody).then(function (dealData) {
      record.deal = dealData;
      record.id = dealData.id;
      record.nonce = dealData.nonce;
      record.amount_currency = dealData.amount_currency;
      record.server_seed_hashed = dealData.server_seed_hashed;
      record.client_seed = dealData.client_seed;
      record.effective_edge = dealData.effective_edge;

      var handId = dealData.id;

      // Check if hand auto-resolved (natural BJ)
      if (!dealData.blackjack.available_actions || dealData.blackjack.available_actions.length === 0) {
        record.final = dealData;
        record.amount_won = dealData.amount_won;
        return record;
      }

      // Play through actions
      function doAction() {
        var lastResp = record.actionResponses.length > 0 ? record.actionResponses[record.actionResponses.length - 1] : null;
        var bj;
        if (lastResp) {
          if (lastResp.blackjack) bj = lastResp.blackjack;
          else if (lastResp.blackjackNext && lastResp.blackjackNext.blackjack) bj = lastResp.blackjackNext.blackjack;
          else bj = null;
        } else {
          bj = dealData.blackjack;
        }

        if (!bj) { record.final = record.actionResponses[record.actionResponses.length - 1]; return Promise.resolve(record); }

        var actions = bj.available_actions || [];
        if (actions.length === 0) {
          // Hand complete
          var lastResp = record.actionResponses[record.actionResponses.length - 1];
          record.final = lastResp.blackjackNext || lastResp;
          record.amount_won = (lastResp.blackjackNext || lastResp).amount_won;
          return Promise.resolve(record);
        }

        // Get active hand
        var activeIdx = bj.player.active_hand_index || 0;
        var activeHand = bj.player.hands[activeIdx];
        var upcard = dealerUp(bj);

        var decision = basicDecision(activeHand, upcard, actions, phase);
        record.actions.push(decision);

        var actionBody = {};
        if (decision === 'stand') {
          actionBody = { active_hand_index: activeIdx, active_hand_size: activeHand.cards.length, active_hand_value: activeHand.value, hand_amount: bj.player.hands.length };
        } else if (decision === 'hit') {
          actionBody = { active_hand_index: activeIdx, active_hand_size: activeHand.cards.length, active_hand_value: activeHand.value, hand_amount: bj.player.hands.length };
        } else if (decision === 'double') {
          actionBody = { active_hand_index: activeIdx, active_hand_size: activeHand.cards.length, active_hand_value: activeHand.value, hand_amount: bj.player.hands.length };
        } else if (decision === 'split') {
          actionBody = { active_hand_index: activeIdx, active_hand_size: activeHand.cards.length, active_hand_value: activeHand.value, hand_amount: bj.player.hands.length };
        } else if (decision === 'no_insurance') {
          actionBody = { accept: false };
          decision = 'insurance'; // API endpoint is /insurance with { accept: false } to decline
        } else if (decision === 'yes_insurance') {
          actionBody = { accept: true };
          decision = 'insurance'; // API endpoint is /insurance with { accept: true } to accept
        }

        return wait(ACTION_DELAY).then(function () {
          return api('POST', '/api/v2/blackjack/' + handId + '/' + decision, actionBody);
        }).then(function (actionResp) {
          record.actionResponses.push(actionResp);

          // Response can be wrapped in blackjackNext (stand/final) or direct (hit/split/double)
          var nextBJ, nextActions, finalData;
          if (actionResp.blackjackNext) {
            finalData = actionResp.blackjackNext;
            nextBJ = finalData.blackjack;
            nextActions = nextBJ ? nextBJ.available_actions || [] : [];
          } else if (actionResp.blackjack) {
            nextBJ = actionResp.blackjack;
            nextActions = nextBJ.available_actions || [];
            finalData = actionResp;
          } else {
            nextActions = [];
            finalData = actionResp;
          }

          if (nextActions.length === 0) {
            record.final = finalData;
            record.amount_won = finalData.amount_won;
            return record;
          }

          return doAction();
        });
      }

      return doAction();
    });
  }

  // ── Seed rotation ───────────────────────────────────────────────────────

  function doRotation(phase, customSeed) {
    return Promise.resolve().then(function () {
      if (!meta.lastNextHash) {
        return getActiveSeed().then(function (s) {
          meta.lastNextHash = s.next_server_seed_hash;
          log('initial next_hash: ' + meta.lastNextHash.slice(0, 24) + '...');
        });
      }
    }).then(function () {
      return rotateSeed(customSeed);
    }).then(function (rot) {
      var entry = {
        at: new Date().toISOString(), context: 'rotate-phase-' + phase, phase: phase,
        seed: { clientSeed: rot.client_seed, serverSeedHashed: rot.server_seed_hashed,
                nextServerSeedHash: rot.next_server_seed_hash, serverSeed: null },
        nonce: 0,
      };
      var promoted = rot.server_seed_hashed === meta.lastNextHash;
      if (promoted) good('promoted: ' + meta.lastNextHash.slice(0, 16) + ' -> ' + rot.server_seed_hashed.slice(0, 16));
      else warn('PROMOTION MISMATCH!');
      meta.lastNextHash = rot.next_server_seed_hash;
      meta.activeServerSeedHashed = rot.server_seed_hashed;
      meta.activeClientSeed = rot.client_seed;

      if (meta.lastTxId) {
        return getTransaction(meta.lastTxId).then(function (tx) {
          var txData = tx.data || tx;
          entry.seed.serverSeed = txData.server_seed || null;
          good('revealed: ' + (entry.seed.serverSeed || 'PENDING').slice(0, 16) + '...');
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        }).catch(function () {
          return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
        });
      }
      return dbPut('seeds', entry).then(function () { seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta(); });
    });
  }

  // ── Main loop ───────────────────────────────────────────────────────────

  function mainLoop() {
    if (paused || INSTANCE < 0) { meta.running = false; saveMeta(); log('stopped.'); return; }

    var phaseIdx = meta.phaseIdx || 0;
    if (phaseIdx >= PHASES.length) {
      // Final seed rotation to reveal the last server seed
      if (meta.lastTxId && !meta.finalRotationDone) {
        meta.finalRotationDone = true;
        good('all phases complete — doing final rotation to reveal last seed...');
        doRotation('final').then(function () {
          meta.running = false; saveMeta(); good('ALL PHASES COMPLETE! Run bj.save() to download.');
        }).catch(function (e) {
          bad('final rotation failed: ' + e.message); meta.running = false; saveMeta();
        });
        return;
      }
      meta.running = false; saveMeta(); good('ALL PHASES COMPLETE! Run bj.save() to download.'); return;
    }

    var ph = PHASES[phaseIdx];
    var phaseDone = (meta.phaseBetCounts[ph.key] || 0) >= ph.total;
    if (phaseDone) { meta.phaseIdx++; meta.phaseBets = 0; meta.epochBets = 0; meta.phaseStarted = false; saveMeta(); return mainLoop(); }

    // Phase start: rotate seed
    if (!meta.phaseStarted) {
      meta.phaseStarted = true;
      var customSeed = ph.customSeeds ? generateAuditSeed(meta.customSeedIdx || 0) : null;
      doRotation(ph.key, customSeed).then(function () {
        saveMeta();
        return mainLoop();
      }).catch(function (e) { bad('rotation error: ' + e.message); meta.errors++; saveMeta(); wait(2000).then(mainLoop); });
      return;
    }

    // Epoch rotation (every BETS_PER_EPOCH hands)
    if (meta.epochBets >= BETS_PER_EPOCH) {
      var customSeed = null;
      if (ph.customSeeds) {
        meta.customSeedIdx = (meta.customSeedIdx || 0) + 1;
        customSeed = generateAuditSeed(meta.customSeedIdx);
      }
      doRotation(ph.key, customSeed).then(function () {
        saveMeta();
        return mainLoop();
      }).catch(function (e) { bad('rotation error: ' + e.message); meta.errors++; saveMeta(); wait(2000).then(mainLoop); });
      return;
    }

    // Play one hand
    ensureToken().then(function (token) {
      return playHand(ph.key, token);
    }).then(function (record) {
      return dbPut('bets', record).then(function () {
        betCount++;
        meta.phaseBets++;
        meta.epochBets++;
        meta.phaseBetCounts[ph.key]++;
        meta.lastTxId = record.id;
        meta.errors = 0;

        var cards = '';
        if (record.deal && record.deal.blackjack) {
          var pc = record.deal.blackjack.player.hands[0].cards.filter(function(c){return !c.face_down;}).map(function(c){return c.rank+c.suit;});
          cards = pc.join(',');
        }
        log(ph.key + ' #' + meta.phaseBetCounts[ph.key] + '/' + ph.total + ' id=' + record.id + ' ' + cards + ' → ' + (record.actions.join(',') || 'auto') + ' won=' + (record.amount_won || '0'));

        return saveMeta();
      });
    }).then(function () {
      return wait(BET_DELAY);
    }).then(function () {
      mainLoop();
    }).catch(function (e) {
      bad('hand error: ' + e.message);
      meta.errors++;
      if (meta.errors >= MAX_ERRORS) { bad('MAX ERRORS — pausing'); paused = true; }
      saveMeta();
      // Try to clear any stuck hand before retrying
      ensureToken().then(function (token) {
        return clearStuckHand(token);
      }).catch(function () {}).then(function () {
        wait(3000).then(mainLoop);
      });
    });
  }

  });

console.log('[bj] reference record loaded — see data/ for the captured dataset');
