var namuapi = {},
   namuapiMutex = {};
if (typeof setImmediate === 'undefined') var setImmediate = c => setTimeout(c, 0);
let wikihost = location.host;
if (location.host === 'board.namu.wiki') wikihost = 'namu.wiki';
// /check 페이지 대응
namuapi.theseedRequest = function (options) {
   var _newoptions = {};
   for (var i in options) {
      if (i !== "onload") {
         _newoptions[i] = options[i];
      } else {
         _newoptions.onload = function (res) {
            console.log('[NamuFix] 위키 측으로부터 응답 받음.');
            var aTagForParsingUrl = document.createElement("a");
            aTagForParsingUrl.href = res.finalUrl;
            if (aTagForParsingUrl.pathname.indexOf("/check") === 0) {
               console.log('[NamuFix] /check 페이지 감지됨.');
               namuapi.resolveRecaptcha(function (capKeyRes) {
                  if (capKeyRes == null) {
                     namuapi.theseedRequest(options);
                  } else {
                     GM.xmlHttpRequest({
                        url: aTagForParsingUrl.href,
                        method: 'POST',
                        data: "g-recaptcha-response=" + encodeURIComponent(capKeyRes),
                        headers: {
                           'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        onload: function (checkRes) {
                           console.log('[NamuFix] /check페이지에 g-recaptcha-response 전송함. 요청 재진행중...');
                           namuapi.theseedRequest(options);
                        }
                     })
                  }
               });
            } else {
               options.onload(res);
            }
         };
      }
   }
   GM.xmlHttpRequest(_newoptions);
}
namuapi.resolveRecaptcha = function (callback) {
   GM.xmlHttpRequest({
      method: 'GET',
      url: `https://${wikihost}/`,
      onload: function (res) {
         var siteKey = /["']sitekey["']: ["']([^"']+)["']/.exec(res.responseText)[1];
         var captchaWin = TooSimplePopup();
         captchaWin.title('reCAPTCHA 해결');
         captchaWin.content(function (winContainer) {
            var id = "nf-recaptcha-" + Date.now();
            var btnId = 'nf-communicate-' + Date.now();
            var cbName = "nfreCAPTCHACallback" + Date.now();
            winContainer.innerHTML = '<p class="nf-recaptcha-description">reCAPTCHA를 해결해주세요.</p><div id="' + id + '"></div><button style="display: none;" type="button" id="' + btnId + '"></button>';
            var injectedButton = winContainer.querySelector('#' + btnId);
            winContainer.querySelector('#' + id)
               .dataset.callback = cbName;
            winContainer.querySelector('#' + id)
               .dataset.sitekey = siteKey;
            injectedButton.addEventListener('click', function (evt) {
               evt.preventDefault();
               callback(injectedButton.dataset.recaptchaResponse);
               captchaWin.close();
            })
            var scriptTag = document.createElement("script");
            scriptTag.innerHTML = 'function ' + cbName + '(recaptcha_response){var btn = document.getElementById("' + btnId + '"); btn.dataset.recaptchaResponse = recaptcha_response; btn.click();}function renderNFReCAPTCHA(){if(!window.grecaptcha) return setTimeout(renderNFReCAPTCHA, 200); window.grecaptcha.render(document.getElementById("' + id + '"));} setTimeout(renderNFReCAPTCHA, 200);';
            winContainer.appendChild(scriptTag);
         });
         captchaWin.button('닫기', function () {
            callback(null);
            captchaWin.close();
         });
      }
   });
}
// getRAW
namuapi.raw = function (title, onfound, onnotfound) {
   namuapi.theseedRequest({
      method: 'GET',
      url: 'https://' + wikihost + '/raw/' + title,
      onload: function (res) {
         if (res.status == 404) {
            onnotfound(title);
            return;
         }
         onfound(res.responseText, title);
      }
   })
}
namuapi.searchBlockHistory = function (options, callback) {
   let query = options.query,
      isAuthor = options.isAuthor,
      from = options.from,
      until = options.until;
   namuapi.theseedRequest({
      method: 'GET',
      url: 'https://' + wikihost + '/BlockHistory?target=' + (isAuthor ? "author" : "text") + '&query=' + encodeURIComponent(query) + (from ? `&from=${from}` : '') + (until ? `&until=${until}` : ''),
      onload: function (res) {
         var parser = new DOMParser();
         var doc = parser.parseFromString(res.responseText, "text/html");
         if (doc.querySelector('ul.wiki-list > li') == null) return callback([]);
         var logs = doc.querySelectorAll('ul.wiki-list > li');
         var result = [];
         // get first entry only
         for (var i = 0; i < logs.length; i++) {
            var curLog = logs[i];
            var durationMatch = /\((.+?)\)/.exec(curLog.querySelector('i')
               .nextSibling.textContent.trim());
            var entry = {
               blocker: curLog.querySelector('strong > a')
                  .textContent.trim(),
               blocked: /^사용자가\s+(.+)/.exec(curLog.querySelector('strong')
                  .nextSibling.textContent.trim())[1],
               duration: durationMatch == null ? null : durationMatch[1],
               reason: curLog.querySelector('span[style]') ? curLog.querySelector('span[style]')
                  .textContent : "",
               type: /\((.+?)\)/.exec(curLog.querySelector('i')
                  .textContent)[1],
               at: new Date(curLog.querySelector('time')
                  .getAttribute('datetime'))
            };
            if (entry.type == "IP 주소 차단") entry.type = "blockIP";
            else if (entry.type == "IP 주소 차단 해제") entry.type = "unblockIP"
            else if (entry.type == "사용자 차단") entry.type = "blockUser";
            else if (entry.type == "사용자 차단 해제") entry.type = "unblockUser";
            else if (entry.type == "사용자 권한 설정") entry.type = "grant";
            result.push(entry);
         }
         let nextButton = doc.querySelector('.wiki-article .btn-group .btn.btn-secondary:nth-child(2)'),
            prevButton = doc.querySelector('.wiki-article .btn-group .btn.btn-secondary:nth-child(1)');
         if (/[&?]from=([0-9]+)/.test(nextButton.href)) {
            result.nextResultPageFrom = /[&?]from=([0-9]+)/.exec(nextButton.href)[1];
         }
         if (/[&?]until=([0-9]+)/.test(prevButton.href)) {
            result.prevResultPageUntil = /[&?]until=([0-9]+)/.exec(prevButton.href)[1];
         }
         callback(result);
      }
   })
}
// sendUploadReq
namuapi.uploadImage = function (data, callback) {
   var query = new FormData();
   query.append('file', data.file);
   query.append('document', data.fn);
   query.append('text', data.docuText);
   query.append('log', data.log);
   query.append('baserev', 0);
   query.append('identifier', data.identifier); // (ENV.IsLoggedIn ? "m" : "i") + ":" + ENV.UserName
   if (data.recaptchaKey !== null && typeof data.recaptchaKey !== 'undefined') query.append('g-recaptcha-response', data.recaptchaKey);
   namuapi.theseedRequest({
      method: 'POST',
      url: `https://${wikihost}/Upload`,
      headers: {
         "Referer": `https://${wikihost}/Upload`
      },
      data: query,
      onload: function (res) {
         var parser = new DOMParser();
         if (parser.parseFromString(res.responseText, "text/html")
            .querySelector("p.wiki-edit-date") != null) {
            callback(null, data.fn);
         } else if (res.responseText.indexOf('CAPTCHA를 체크하지 않은 경우입니다.') != -1) {
            callback("recaptcha_required");
         } else {
            callback("html_error", res.responseText);
         }
      }
   });
}
namuapi.blockIP = function (data, callback) {
   namuapi.theseedRequest({
      method: 'POST',
      url: `https://${wikihost}/admin/ipacl`,
      data: 'ip=' + encodeURIComponent(data.ip) + '&note=' + encodeURIComponent(data.note || "") + '&expire=' + encodeURIComponent(data.expire) + (data.allowLogin ? '&allow_login=Y' : ''),
      headers: {
         "Content-Type": "application/x-www-form-urlencoded",
         "Referer": `https://${wikihost}/admin/ipacl`
      },
      onload: function (res) {
         var parser = new DOMParser();
         var resDoc = parser.parseFromString(res.responseText, "text/html");
         if (resDoc.querySelector('p.error-desc, .alert.alert-danger')) {
            callback(resDoc.querySelector('p.error-desc, .alert.alert-danger')
               .textContent);
         } else {
            callback(null, data);
         }
      }
   })
};
// data = {rev, docname,  user, [log], [isIP]}
namuapi.tryRevert = function (data) {
   return new Promise((resolve, reject) => {
      let {
         rev,
         docname,
         user
      } = data;
      let isIP = data.isIP || validateIP(data.user);
      let log = data.log || "";
      let identifier = `${isIP ? 'i' : 'm'}:${user}`;
      let url = `https://${wikihost}/revert/${encodeURIComponent(docname)}?rev=${rev}`;
      console.log(url);
      namuapi.theseedRequest({
         method: 'POST',
         url: url,
         data: `rev=${rev}&identifier=${identifier}&log=${log}`,
         headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": url
         },
         onload: function (res) {
            if (/^https?:\/\/.+?\/w\//.test(res.finalUrl)) {
               resolve();
            } else {
               reject(res.responseText);
            }
         }
      })
   });
};
namuapi.unblockIP = function (ip, callback) {
   namuapi.theseedRequest({
      method: 'POST',
      url: `https://${wikihost}/admin/ipacl/remove`,
      data: 'ip=' + encodeURIComponent(ip),
      headers: {
         "Content-Type": "application/x-www-form-urlencoded",
         "Referer": `https://${wikihost}/admin/ipacl`
      },
      onload: function (res) {
         var parser = new DOMParser();
         var resDoc = parser.parseFromString(res.responseText, "text/html");
         if (resDoc.querySelector('p.error-desc, .alert.alert-danger')) {
            callback(resDoc.querySelector('p.error-desc, .alert.alert-danger')
               .textContent);
         } else {
            callback(null, ip);
         }
      }
   })
};
namuapi.blockAccount = function (data, callback) {
   namuapi.theseedRequest({
      method: 'POST',
      url: `https://${wikihost}/admin/suspend_account`,
      data: 'username=' + encodeURIComponent(data.id) + '&note=' + encodeURIComponent(data.note || "") + '&expire=' + encodeURIComponent(data.expire),
      headers: {
         "Content-Type": "application/x-www-form-urlencoded",
         "Referer": `https://${wikihost}/admin/suspend_account`
      },
      onload: function (res) {
         var parser = new DOMParser();
         var resDoc = parser.parseFromString(res.responseText, "text/html");
         if (resDoc.querySelector('p.error-desc, .alert.alert-danger')) {
            callback(resDoc.querySelector('p.error-desc, .alert.alert-danger')
               .textContent);
         } else {
            callback(null, data);
         }
      }
   })
};
window.namuapi = namuapi;
