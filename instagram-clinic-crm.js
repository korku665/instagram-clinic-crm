(function() {
  var old = document.getElementById("ig-crm-app");
  if (old) old.remove();
  var oldBubble = document.getElementById("ig-crm-bubble");
  if (oldBubble) oldBubble.remove();
  if (window.__CRM_SYNC_TIMER__) {
    clearInterval(window.__CRM_SYNC_TIMER__);
    window.__CRM_SYNC_TIMER__ = null;
  }

  var DB = {
    threads: (window.__CLINIC_DB__ && window.__CLINIC_DB__.threads) ? window.__CLINIC_DB__.threads : {},
    blacklist: (window.__CLINIC_DB__ && window.__CLINIC_DB__.blacklist) ? window.__CLINIC_DB__.blacklist : {},
    isFetching: false,
    lastKnownTimestamp: 0,
    renderLimit: 50,
    selectedGender: "female",
    activeMatchedThreadId: null
  };
  window.__CLINIC_DB__ = DB;

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : '';
  }

  function extractFirstName(raw) {
    if (!raw) return "";
    var s = String(raw).trim();

    s = s.replace(/^(uzm[\.\s]*dt[\.\s]*|uzm[\.\s]+|dt[\.\s]+|dr[\.\s]+|prof[\.\s]+|doç[\.\s]+|doc[\.\s]+|av[\.\s]+)/gi, "").trim();
    s = s.replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    try { s = s.normalize("NFKC"); } catch(e) {}
    s = s.replace(/^[^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]+/, "").trim();

    var parts = s.split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      if (/^(uzm|dt|dr|prof|doc)$/i.test(parts[0]) && parts.length > 1) {
        return parts[1];
      }
      return parts[0];
    }
    return "";
  }

  function resolveSafeName(rawTitle, other) {
    var candidate = "";
    if (other && other.full_name && other.full_name.trim().length > 0) {
      candidate = other.full_name.trim();
    } else if (rawTitle && rawTitle.trim().length > 0) {
      candidate = rawTitle.trim();
    } else if (other && other.username && other.username.trim().length > 0) {
      candidate = other.username.trim();
    } else {
      return "";
    }

    var s = candidate.replace(/[\uff01-\uff5e]/g, function(ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
    try { s = s.normalize("NFKC"); } catch(e) {}
    var cleaned = s.replace(/^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g, "").trim();
    return cleaned.length > 0 ? cleaned : candidate;
  }

  function cleanSearchText(str) {
    if (!str) return "";
    try {
      return str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    } catch(e) {
      return String(str).toLowerCase().trim();
    }
  }

  var CLINIC_WORDS = ["invisalign", "plak", "seffaf", "tel", "dis", "fiyat", "randevu", "ucret", "muayene", "tedavi", "ortodonti", "klinik", "cene", "braket"];
  var PERSONAL_WORDS = ["teyze", "abla", "abi", "kuzen", "anne", "baba", "canim", "askim", "bitanem", "neredesin", "kahve", "aksam", "geliyorum"];

  function analyzeContactType(t) {
    if (DB.blacklist[t.id]) return "personal";
    var full = cleanSearchText(t.title + " " + t.messages.map(function(m){ return m.text; }).join(" "));
    var cScore = 0, pScore = 0;
    for (var i = 0; i < CLINIC_WORDS.length; i++) if (full.indexOf(CLINIC_WORDS[i]) > -1) cScore++;
    for (var j = 0; j < PERSONAL_WORDS.length; j++) if (full.indexOf(PERSONAL_WORDS[j]) > -1) pScore++;
    if (pScore > cScore && cScore === 0) return "personal";
    if (cScore > 0) return "patient";
    return "general";
  }

  function upsertThread(th) {
    var tid = String(th.thread_id || th.id || "");
    if (!tid) return;

    var other = (th.users && th.users[0]) ? th.users[0] : null;
    var rawTitle = th.thread_title || (other ? (other.full_name || other.username) : "");
    var title = resolveSafeName(rawTitle, other) || "Kullanıcı";
    var username = other ? String(other.username || "") : "";

    // YENİ: Mevcut konuşmadaki mesajları koru
    var existingThread = DB.threads[tid];
    var existingMessages = existingThread && existingThread.messages
      ? existingThread.messages.slice()
      : [];

    var maxTs = 0;

    if (th.items && th.items.length > 0) {
      for (var i = 0; i < th.items.length; i++) {
        var item = th.items[i];
        var txt = item.text || (item.item_type ? "[" + item.item_type + "]" : "[Mesaj]");
        var isMe = String(item.user_id) !== String(other ? other.pk : "");
        var ts = Number(item.timestamp) || 0;

        if (ts > maxTs) maxTs = ts;

        var newMsg = {
          id: item.item_id,
          text: txt,
          sender: isMe ? "Sen" : "Danışan",
          timestamp: ts
        };

        // Aynı mesajı ikinci kez ekleme
        var alreadyExists = false;

        for (var j = 0; j < existingMessages.length; j++) {
          if (
            String(existingMessages[j].id) === String(newMsg.id) ||
            (
              existingMessages[j].timestamp === newMsg.timestamp &&
              existingMessages[j].text === newMsg.text
            )
          ) {
            alreadyExists = true;
            break;
          }
        }

        if (!alreadyExists) {
          existingMessages.push(newMsg);
        }
      }
    }

    // Eskiden yeniye sırala
    existingMessages.sort(function(a, b) {
      return (a.timestamp || 0) - (b.timestamp || 0);
    });

    if (maxTs > DB.lastKnownTimestamp) DB.lastKnownTimestamp = maxTs;

    DB.threads[tid] = {
      id: tid,
      title: title,
      username: username,
      messages: existingMessages,
      lastSender: existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].sender : "Yok",
      lastMsg: existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].text : "",
      timestamp: maxTs || (
        existingMessages.length > 0
          ? existingMessages[existingMessages.length - 1].timestamp
          : 0
      )
    };
  }

  var rafId = null;
  function scheduleFastRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(function() {
      rafId = null;
      renderList();
    });
  }

  function fetchInboxBatch(cursor, onFinish) {
    if (!DB.isFetching) return;

    var csrf = getCookie("csrftoken");
    var url = "/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=100";
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

    var headers = {
      "X-CSRFToken": csrf,
      "X-IG-App-ID": "936619743392459",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "*/*"
    };

    updateStatus(true, "Taranıyor (" + Object.keys(DB.threads).length + " kişi alındı)...");

    fetch(url, { method: "GET", headers: headers, credentials: "include" })
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") === -1) throw new Error("RATE_LIMIT");
      return res.json();
    })
    .then(function(data) {
      if (data.inbox && data.inbox.threads) {
        var threads = data.inbox.threads;
        for (var i = 0; i < threads.length; i++) {
          upsertThread(threads[i]);
        }

        scheduleFastRender();

        var oldestCursor = data.inbox.oldest_cursor;
        if (oldestCursor && DB.isFetching) {
          setTimeout(function() {
            fetchInboxBatch(oldestCursor, onFinish);
          }, 350);
        } else {
          stopFetch("Tamamlandı! (" + Object.keys(DB.threads).length + " kişi).");
          scheduleFastRender();
          if (onFinish) onFinish();
        }
      } else {
        stopFetch("Gelen kutusu sonuna ulaşıldı.");
        scheduleFastRender();
      }
    })
    .catch(function(err) {
      stopFetch(err.message === "RATE_LIMIT" ? "Instagram hız uyarısı." : "Bağlantı hatası.");
      scheduleFastRender();
    });
  }

  function stopFetch(msg) {
    DB.isFetching = false;
    updateStatus(false, msg || "Hazır");
  }

  // YENİ: Tam tarama bittikten sonra yeni mesajları kontrol eder
  function syncLatestMessages() {
    if (DB.isFetching) return;

    var csrf = getCookie("csrftoken");
    var url = "/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=100";

    var headers = {
      "X-CSRFToken": csrf,
      "X-IG-App-ID": "936619743392459",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "*/*"
    };

    fetch(url, {
      method: "GET",
      headers: headers,
      credentials: "include"
    })
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);

      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") === -1) {
        throw new Error("RATE_LIMIT");
      }

      return res.json();
    })
    .then(function(data) {
      if (!data.inbox || !data.inbox.threads) return;

      var changed = false;
      var threads = data.inbox.threads;

      for (var i = 0; i < threads.length; i++) {
        var thread = threads[i];
        var tid = String(thread.thread_id || thread.id || "");

        if (!tid) continue;

        var before = DB.threads[tid]
          ? JSON.stringify(DB.threads[tid].messages)
          : "";

        upsertThread(thread);

        var after = DB.threads[tid]
          ? JSON.stringify(DB.threads[tid].messages)
          : "";

        if (before !== after) {
          changed = true;
        }
      }

      if (changed) {
        scheduleFastRender();
      }
    })
    .catch(function(err) {
      console.log("[CRM] Arka plan senkronizasyon hatası:", err.message);
    });
  }

  function navigateToThread(threadId) {
    DB.activeMatchedThreadId = threadId;
    renderList();

    var links = document.querySelectorAll('a[href*="/direct/t/"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("href").indexOf(threadId) > -1) {
        links[i].click();
        return;
      }
    }
    window.history.pushState({}, "", "/direct/t/" + threadId + "/");
    window.dispatchEvent(new Event("popstate"));
  }

  function writeToEditorOnce(editor, text) {
    editor.focus();

    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);

    document.execCommand("insertText", false, text);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function(){});
    }
  }

  // --- İÇERİK VE MESAJ EŞLEME MOTORU (MATCHING ENGINE) ---
  function matchActiveThreadByContent() {
    // 1. Önce URL'deki thread id'ye bak
    var m = window.location.pathname.match(/\/direct\/t\/([^/?#]+)/);
    var urlTid = m ? m[1] : "";
    if (urlTid && DB.threads[urlTid]) {
      DB.activeMatchedThreadId = urlTid;
      return DB.threads[urlTid];
    }

    // 2. Ekrandaki son mesaj balonlarının metinlerini topla
    var main = document.querySelector('main[role="main"]') || document.querySelector('section') || document.body;
    var msgNodes = main.querySelectorAll('div[role="row"] div[dir="auto"], div[dir="auto"]');
    var screenTexts = [];
    for (var i = Math.max(0, msgNodes.length - 15); i < msgNodes.length; i++) {
      var txt = (msgNodes[i].innerText || "").trim().toLowerCase();
      if (txt.length > 2 && txt.length < 200 && txt.indexOf("yazıyor") === -1) {
        screenTexts.push(txt);
      }
    }

    // 3. Hafızadaki konuşmalarla eşleştir
    if (screenTexts.length > 0) {
      var allTids = Object.keys(DB.threads);
      for (var t = 0; t < allTids.length; t++) {
        var thread = DB.threads[allTids[t]];
        var threadMsgs = thread.messages.map(function(msg) { return (msg.text || "").toLowerCase(); });

        for (var s = 0; s < screenTexts.length; s++) {
          for (var tm = 0; tm < threadMsgs.length; tm++) {
            if (threadMsgs[tm].indexOf(screenTexts[s]) > -1 || screenTexts[s].indexOf(threadMsgs[tm]) > -1) {
              DB.activeMatchedThreadId = thread.id;
              return thread;
            }
          }
        }
      }
    }

    // 4. Eğer daha önce eşleşen varsa onu koru
    if (DB.activeMatchedThreadId && DB.threads[DB.activeMatchedThreadId]) {
      return DB.threads[DB.activeMatchedThreadId];
    }

    return null;
  }

  function openAndFillMessage(threadId, specificName) {
    if (threadId) {
      navigateToThread(threadId);
    }

    var attempts = 0;
    var poll = setInterval(function() {
      attempts++;
      var editor = document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                   document.querySelector('div[aria-label="Mesaj..."]') ||
                   document.querySelector('div[aria-label="Message..."]') ||
                   document.querySelector('div[contenteditable="true"]') ||
                   document.querySelector('textarea[placeholder*="Mesaj"]');

      if (editor && editor.getAttribute("aria-label") !== "Arama girdisi" && !editor.closest('#ig-crm-app')) {
        clearInterval(poll);

        // Doğrudan içerik eşleşmesinden ismi al
        var matched = matchActiveThreadByContent();
        var targetTitle = specificName || (matched ? matched.title : "");
        
        var firstName = extractFirstName(targetTitle);
        var hitapText = (DB.selectedGender === "female") ? "Hanım" : "Bey";

        var rawText = document.getElementById("crm-draft-template").value.trim();
        if (!rawText) rawText = "Merhaba {isim} {hitap},";

        var filledText = "";
        if (firstName) {
          filledText = rawText.replace(/{isim}/g, firstName).replace(/{hitap}/g, hitapText);
        } else {
          filledText = rawText.replace(/{isim}/g, "Danışanımız").replace(/{hitap}/g, hitapText);
        }

        setTimeout(function() {
          writeToEditorOnce(editor, filledText);
          renderList();
        }, 60);
      } else if (attempts > 25) {
        clearInterval(poll);
      }
    }, 100);
  }

  function setupUI() {
    var bubble = document.createElement("div");
    bubble.id = "ig-crm-bubble";
    bubble.style.cssText = "position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:#0284c7;border-radius:50%;box-shadow:0 6px 20px rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;cursor:pointer;z-index:99999999;font-size:24px;user-select:none;";
    bubble.innerHTML = "🦷";
    document.body.appendChild(bubble);

    var panel = document.createElement("div");
    panel.id = "ig-crm-app";
    panel.style.cssText = [
      "position: fixed",
      "bottom: 20px",
      "right: 20px",
      "width: 760px",
      "height: 600px",
      "min-width: 440px",
      "min-height: 350px",
      "background: #111827",
      "color: #f3f4f6",
      "border: 1px solid #374151",
      "border-radius: 8px",
      "box-shadow: 0 16px 36px rgba(0,0,0,0.6)",
      "z-index: 99999999",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "font-size: 13px",
      "display: flex",
      "flex-direction: column",
      "overflow: hidden",
      "contain: layout style"
    ].join(";");

    panel.innerHTML = [
      '<div id="crm-resizer-tl" style="position: absolute; top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; z-index: 100;"></div>',
      '<div id="crm-resizer-left" style="position: absolute; top: 0; left: 0; width: 6px; height: 100%; cursor: ew-resize; z-index: 99;"></div>',
      '<div id="crm-resizer-top" style="position: absolute; top: 0; left: 0; width: 100%; height: 6px; cursor: ns-resize; z-index: 99;"></div>',

      '<div id="crm-header" style="padding: 10px 14px; background: #1f2937; border-bottom: 1px solid #374151; display: flex; justify-content: space-between; align-items: center; user-select: none;">',
      '  <div style="display: flex; align-items: center; gap: 8px;">',
      '    <span style="font-size: 15px;">🦷</span>',
      '    <span style="font-weight: 700; color: #38bdf8; font-size: 13px;">Klinik Hasta & DM Paneli</span>',
      '    <span id="crm-status-text" style="font-size: 11px; color: #9ca3af; background: #111827; padding: 2px 7px; border-radius: 12px;">Hazır (Manuel Mod)</span>',
      '  </div>',
      '  <div style="display: flex; gap: 6px; align-items: center;">',
      '    <span id="crm-total-badge" style="background: #1e3a8a; color: #60a5fa; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;">0 Danışan</span>',
      '    <button id="crm-btn-json" style="background: #374151; border: none; color: #d1d5db; border-radius: 4px; cursor: pointer; padding: 3px 8px; font-size: 11px;">JSON</button>',
      '    <button id="crm-btn-hide" style="background: #374151; border: none; color: #fff; border-radius: 4px; cursor: pointer; padding: 3px 8px; font-weight: bold;">—</button>',
      '  </div>',
      '</div>',

      '<div style="padding: 8px 12px; background: #182234; border-bottom: 1px solid #374151; display: flex; gap: 8px;">',
      '  <button id="crm-btn-fetch-all" style="flex: 2.5; background: #059669; color: #fff; border: none; padding: 9px; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 12px;">🚀 Konuşmaları Çek (Tam Tarama)</button>',
      '  <button id="crm-btn-stop" style="flex: 1; background: #dc2626; color: #fff; border: none; padding: 9px; border-radius: 5px; cursor: pointer; font-weight: 600; font-size: 12px;">Durdur</button>',
      '</div>',

      '<div style="padding: 8px 12px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; gap: 8px; align-items: center;">',
      '  <input id="crm-search" placeholder="İsim veya mesajda ara..." style="flex: 2; padding: 7px 10px; background: #1f2937; border: 1px solid #374151; color: #fff; border-radius: 5px; outline: none; font-size: 12px;" />',
      '  <select id="crm-filter-cat" style="flex: 1.2; padding: 7px 8px; background: #1f2937; border: 1px solid #374151; color: #d1d5db; border-radius: 5px; outline: none; font-size: 12px;">',
      '    <option value="patients_only">Sadece Hastalar</option>',
      '    <option value="unanswered">🔴 Cevap Bekleyenler</option>',
      '    <option value="invisalign">💎 Invisalign / Plak</option>',
      '    <option value="pricing">💰 Fiyat / Randevu</option>',
      '    <option value="personal">👤 Aile / Kişisel</option>',
      '    <option value="all">Tüm Konuşmalar</option>',
      '  </select>',
      '</div>',

      '<div id="crm-list" style="flex: 1; overflow-y: auto; padding: 10px 12px; background: #0b0f19;"></div>',

      '<div style="padding: 8px 12px; background: #1f2937; border-top: 1px solid #374151; display: flex; flex-direction: column; gap: 6px;">',
      '  <div style="display: flex; justify-content: space-between; align-items: center;">',
      '    <span style="font-weight: 600; color: #9ca3af; font-size: 11px;">Yanıt Şablonu ({isim} ve {hitap}):</span>',
      '    <div style="display: flex; gap: 6px; align-items: center;">',
      '      <span style="font-size: 11px; color: #aaa;">Hitap:</span>',
      '      <button id="crm-gender-female" style="background: #0284c7; border: 1px solid #38bdf8; color: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">👩 Kadın (Hanım)</button>',
      '      <button id="crm-gender-male" style="background: #242c3d; border: 1px solid #475569; color: #94a3b8; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">👨 Erkek (Bey)</button>',
      '    </div>',
      '  </div>',
      '  <div style="display: flex; gap: 8px; align-items: center;">',
      '    <input id="crm-draft-template" value="Merhaba {isim} {hitap}, ortodonti tedavi süreciniz hakkında bilgi vermek için ulaşıyoruz." style="flex: 1; padding: 7px 10px; background: #111827; border: 1px solid #374151; color: #fff; border-radius: 4px; font-size: 12px; outline: none;" />',
      '    <button id="crm-btn-fill-active" style="background: #0284c7; border: none; color: #fff; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-weight: 700; font-size: 11px; white-space: nowrap; box-shadow: 0 2px 8px rgba(2,132,199,0.3);">⚡ Doldur</button>',
      '  </div>',
      '</div>'
    ].join("");

    document.body.appendChild(panel);
    bindEvents();
    renderList();
  }

  function updateStatus(active, text) {
    var statEl = document.getElementById("crm-status-text");
    if (statEl) {
      statEl.innerText = text;
      statEl.style.color = active ? "#38bdf8" : "#9ca3af";
    }
  }

  function getFilteredList() {
    var q = cleanSearchText(document.getElementById("crm-search") ? document.getElementById("crm-search").value : "");
    var cat = document.getElementById("crm-filter-cat") ? document.getElementById("crm-filter-cat").value : "patients_only";

    var all = Object.keys(DB.threads).map(function(k) { return DB.threads[k]; });
    all.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

    return all.filter(function(t) {
      var type = analyzeContactType(t);
      if (cat === "patients_only" && type === "personal") return false;
      if (cat === "personal" && type !== "personal") return false;
      if (cat === "unanswered" && (type === "personal" || t.lastSender !== "Danışan")) return false;

      var fullText = cleanSearchText(t.title + " " + t.messages.map(function(m){ return m.text; }).join(" "));
      if (cat === "invisalign" && fullText.indexOf("invisalign") === -1 && fullText.indexOf("plak") === -1 && fullText.indexOf("seffaf") === -1) return false;
      if (cat === "pricing" && fullText.indexOf("fiyat") === -1 && fullText.indexOf("ucret") === -1 && fullText.indexOf("randevu") === -1) return false;

      if (q.length > 0) {
        return cleanSearchText(t.title).indexOf(q) > -1 || cleanSearchText(t.username).indexOf(q) > -1 || fullText.indexOf(q) > -1;
      }
      return true;
    });
  }

  function renderList() {
    var listEl = document.getElementById("crm-list");
    var badge = document.getElementById("crm-total-badge");
    if (!listEl) return;

    var filtered = getFilteredList();
    badge.innerText = Object.keys(DB.threads).length + " Danışan";

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="color: #6b7280; text-align: center; padding: 40px; font-size: 13px;">Görüntülenecek hasta bulunamadı.<br>Yukarıdaki butondan konuşmaları çekebilirsiniz.</div>';
      return;
    }

    var slice = filtered.slice(0, DB.renderLimit);
    var html = "";

    for (var i = 0; i < slice.length; i++) {
      var item = slice[i];
      var type = analyzeContactType(item);
      var isPending = item.lastSender === "Danışan";
      
      var isMatched = (DB.activeMatchedThreadId && DB.activeMatchedThreadId === item.id);
      var cardStyle = isMatched
        ? "background: #1e293b; border: 2px solid #38bdf8; box-shadow: 0 0 12px rgba(56, 189, 248, 0.4);"
        : "background: #1f2937; border: 1px solid #374151;";

      var badgeHtml = type === "personal"
        ? '<span style="background: #374151; color: #9ca3af; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Kişisel</span>'
        : (isPending ? '<span style="background: #991b1b; color: #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">CEVAP BEKLİYOR</span>' : '<span style="background: #065f46; color: #a7f3d0; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Hasta</span>');

      var toggleBtnText = type === "personal" ? "Hastaya Al" : "Kişisel Yap";

      html += '<div class="crm-card" data-tid="' + item.id + '" style="' + cardStyle + ' border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: all 0.2s;">';
      html += '  <div style="display: flex; justify-content: space-between; align-items: center;">';
      html += '    <div>';
      if (isMatched) html += '      <span style="color: #38bdf8; font-size: 10px; font-weight: bold; margin-right: 4px;">▶ AÇIK:</span>';
      html += '      <strong style="color: ' + (isMatched ? '#7dd3fc' : '#38bdf8') + '; font-size: 12px;">' + item.title + '</strong> <span style="color: #6b7280; font-size: 11px;">@' + (item.username || 'dm') + '</span>';
      html += '    </div>';
      html += '    <div style="display: flex; gap: 5px; align-items: center;">';
      html += '      ' + badgeHtml;
      html += '      <button class="crm-btn-type" data-id="' + item.id + '" style="background: #111827; border: 1px solid #374151; color: #9ca3af; padding: 2px 6px; border-radius: 3px; font-size: 10px; cursor: pointer;">' + toggleBtnText + '</button>';
      html += '      <button class="crm-btn-fill" data-id="' + item.id + '" data-name="' + encodeURIComponent(item.title) + '" style="background: #0284c7; border: none; color: #fff; padding: 3px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; cursor: pointer;">💬 Doldur</button>';
      html += '    </div>';
      html += '  </div>';
      html += '  <div style="background: #111827; padding: 5px 8px; border-radius: 4px; margin-top: 5px; font-size: 11px; color: #d1d5db; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">';
      html += '    <span style="color: #38bdf8;">' + item.lastSender + ':</span> ' + (item.lastMsg || '(Mesaj yok)');
      html += '  </div>';
      html += '</div>';
    }

    if (filtered.length > DB.renderLimit) {
      html += '<div style="text-align: center; padding: 8px; color: #6b7280; font-size: 11px;">Daha fazlası için aşağı kaydırın... (' + slice.length + '/' + filtered.length + ')</div>';
    }

    listEl.innerHTML = html;
  }

  function bindEvents() {
    var panel = document.getElementById("ig-crm-app");
    var bubble = document.getElementById("ig-crm-bubble");
    var listEl = document.getElementById("crm-list");

    document.getElementById("crm-btn-hide").onclick = function() {
      panel.style.display = "none";
      bubble.style.display = "flex";
    };

    bubble.onclick = function() {
      bubble.style.display = "none";
      panel.style.display = "flex";
    };

    var btnFemale = document.getElementById("crm-gender-female");
    var btnMale = document.getElementById("crm-gender-male");

    btnFemale.onclick = function() {
      DB.selectedGender = "female";
      btnFemale.style.background = "#0284c7";
      btnFemale.style.borderColor = "#38bdf8";
      btnFemale.style.color = "#fff";
      btnMale.style.background = "#242c3d";
      btnMale.style.borderColor = "#475569";
      btnMale.style.color = "#94a3b8";
    };

    btnMale.onclick = function() {
      DB.selectedGender = "male";
      btnMale.style.background = "#0284c7";
      btnMale.style.borderColor = "#38bdf8";
      btnMale.style.color = "#fff";
      btnFemale.style.background = "#242c3d";
      btnFemale.style.borderColor = "#475569";
      btnFemale.style.color = "#94a3b8";
    };

    document.getElementById("crm-btn-fill-active").onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      var matched = matchActiveThreadByContent();
      var nameToUse = matched ? matched.title : "";
      openAndFillMessage(matched ? matched.id : null, nameToUse);
    };

    listEl.onclick = function(e) {
      var fillBtn = e.target.closest(".crm-btn-fill");
      if (fillBtn) {
        e.preventDefault();
        e.stopPropagation();
        var tId = fillBtn.getAttribute("data-id");
        var tName = decodeURIComponent(fillBtn.getAttribute("data-name") || "");
        DB.activeMatchedThreadId = tId;
        openAndFillMessage(tId, tName);
        return;
      }

      var typeBtn = e.target.closest(".crm-btn-type");
      if (typeBtn) {
        e.preventDefault();
        e.stopPropagation();
        var tid = typeBtn.getAttribute("data-id");
        if (DB.blacklist[tid]) delete DB.blacklist[tid];
        else DB.blacklist[tid] = true;
        renderList();
        return;
      }

      var card = e.target.closest(".crm-card");
      if (card) {
        var clickedTid = card.getAttribute("data-tid");
        navigateToThread(clickedTid);
      }
    };

    listEl.onscroll = function() {
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 40) {
        var filtered = getFilteredList();
        if (DB.renderLimit < filtered.length) {
          DB.renderLimit += 40;
          renderList();
        }
      }
    };

    document.getElementById("crm-btn-fetch-all").onclick = function() {
      if (DB.isFetching) return;
      DB.isFetching = true;
      fetchInboxBatch(null);
    };

    document.getElementById("crm-btn-stop").onclick = function() {
      stopFetch("Durduruldu.");
    };

    var searchTimer = null;
    document.getElementById("crm-search").oninput = function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function() {
        DB.renderLimit = 50;
        renderList();
      }, 100);
    };

    document.getElementById("crm-filter-cat").onchange = function() {
      DB.renderLimit = 50;
      renderList();
    };

    // RESIZE
    var isResizing = false;
    var startX, startY, startW, startH;
    function initResize(e) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = parseInt(panel.offsetWidth, 10);
      startH = parseInt(panel.offsetHeight, 10);
      window.addEventListener('mousemove', doResize, { passive: true });
      window.addEventListener('mouseup', stopResize, { passive: true });
      e.preventDefault();
    }

    function doResize(e) {
      if (!isResizing) return;
      requestAnimationFrame(function() {
        var newW = Math.max(440, startW - (e.clientX - startX));
        var newH = Math.max(350, startH - (e.clientY - startY));
        panel.style.width = newW + 'px';
        panel.style.height = newH + 'px';
      });
    }

    function stopResize() {
      isResizing = false;
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    }

    document.getElementById("crm-resizer-tl").addEventListener('mousedown', initResize);
    document.getElementById("crm-resizer-left").addEventListener('mousedown', initResize);
    document.getElementById("crm-resizer-top").addEventListener('mousedown', initResize);

    document.getElementById("crm-btn-json").onclick = function() {
      var blob = new Blob([JSON.stringify(DB.threads, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "klinik_danisanlar_" + Date.now() + ".json";
      a.click();
    };

    document.addEventListener("click", function(e) {
      if (!e.target.closest('#ig-crm-app')) {
        setTimeout(function() {
          var matched = matchActiveThreadByContent();
          if (matched) renderList();
        }, 300);
      }
    }, { passive: true });
  }

  setupUI();

  // YENİ: Her 10 saniyede bir yeni mesajları kontrol et
  if (window.__CRM_SYNC_TIMER__) {
    clearInterval(window.__CRM_SYNC_TIMER__);
  }

  window.__CRM_SYNC_TIMER__ = setInterval(function() {
    syncLatestMessages();
  }, 10000);

  console.log("[CRM] v16 devrede: Mesaj İçerik Eşleme (Content Matching) & Aktif Kart Vurgulama aktif!");
})();