/* 小卖部 · 激活码服务 · 前端逻辑
 * 依赖（按 index.html 中的加载顺序）：
 *   js/issued-digest.js  -> ISSUED_DIGEST（自实现 SHA-256 迭代摘要）
 *   js/issued-codes.js   -> ISSUED（已发行兑换码摘要清单）
 *   js/activation-core.js-> AC（与手环端逐字一致的算法核心）
 *
 * 设计要点：
 *   - 全部计算在浏览器本地完成，不发起任何网络请求，不上传兑换码 / 设备码。
 *   - 兑换码需同时通过「格式校验（rcOk）」与「本站已发行批次（ISSUED.has）」两道门，
 *     避免随便敲 12 位数字就被放行。
 *   - 激活码由「兑换码 + 设备码」共同推导，因此每台设备各不相同。
 */

(function () {
  'use strict';

  var RC_LEN = 12;
  var DEV_LEN = 10;

  /* ---------- 输入清洗：只保留数字，并截断到规定长度 ---------- */
  function digitsOnly(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[^0-9]/g, '');
  }

  function bindDigits(el, max) {
    if (!el) { return; }
    var handler = function () {
      var t = digitsOnly(el.value).slice(0, max);
      if (t !== el.value) { el.value = t; }
    };
    el.addEventListener('input', handler);
    el.addEventListener('paste', function () { setTimeout(handler, 0); });
  }

  /* ---------- 纯计算：给定兑换码与设备码，返回兑换结果 ---------- */
  function redeem(rcRaw, devRaw) {
    var rc = digitsOnly(rcRaw);
    var dev = digitsOnly(devRaw);

    if (rc.length !== RC_LEN) {
      return { ok: false, code: 'rc_len', msg: '兑换码应为 ' + RC_LEN + ' 位数字（当前 ' + rc.length + ' 位）。不用输入分隔符，例如 010006109174。' };
    }
    if (!AC.rcOk(rc)) {
      return { ok: false, code: 'rc_sum', msg: '这串兑换码的校验位不匹配，可能抄写有误。请对照商家私信里的 12 位数字重新输入。' };
    }
    if (!ISSUED.has(rc)) {
      return { ok: false, code: 'rc_unissued', msg: '不在本站已发行批次：这串数字不是本站发放的兑换码，或有多位数字抄错。请向商家核对后重试。' };
    }
    if (dev.length !== DEV_LEN) {
      return { ok: false, code: 'dev_len', msg: '设备码应为 ' + DEV_LEN + ' 位数字（手环上显示为 5-5 两段，例如 21363-93151）。当前 ' + dev.length + ' 位。' };
    }
    if (!AC.devOk(dev)) {
      return { ok: false, code: 'dev_sum', msg: '设备码校验位不通过，可能是抄错了。请回到手环「小卖部」激活页，重新核对这 10 位数字。' };
    }

    var ac = AC.acFor(rc, dev);
    if (ac.length !== 12) {
      return { ok: false, code: 'calc', msg: '计算未完成，请检查输入后重试。' };
    }

    var v = AC.verify(rc, dev, ac);
    var seq = ISSUED.posOf(rc);

    return {
      ok: true,
      code: 'ok',
      msg: '兑换成功：这串激活码只对设备码 ' + AC.fmtDev(dev) + ' 的这台手环有效。',
      rc: rc,
      dev: dev,
      ac: ac,
      acFmt: AC.fmtAc(ac),
      rcFmt: AC.fmtRc(rc),
      devFmt: AC.fmtDev(dev),
      seq: seq,
      batch: ISSUED.BATCH,
      selfCheck: !!(v && v.ok)
    };
  }

  /* ---------- 复制：Clipboard API，失败回退 execCommand ---------- */
  function copyText(text, done) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) {
        done(false);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 页面绑定 ---------- */
  function init() {
    var rRc = document.getElementById('rRc');
    var rDev = document.getElementById('rDev');
    var rBtn = document.getElementById('rBtn');
    var rClear = document.getElementById('rClear');
    var rMsg = document.getElementById('rMsg');
    var rOut = document.getElementById('rOut');
    var rAc = document.getElementById('rAc');
    var rLine = document.getElementById('rLine');
    var rVerdict = document.getElementById('rVerdict');
    var rCopy = document.getElementById('rCopy');

    bindDigits(rRc, RC_LEN);
    bindDigits(rDev, DEV_LEN);

    var current = null;

    function showMsg(text, kind) {
      if (!rMsg) { return; }
      rMsg.className = 'msg' + (kind ? ' ' + kind : '');
      rMsg.textContent = text || '';
    }

    function clearOut() {
      current = null;
      if (rOut) { rOut.hidden = true; }
      if (rAc) { rAc.textContent = '—'; }
      if (rLine) { rLine.textContent = ''; }
      if (rVerdict) { rVerdict.textContent = ''; rVerdict.className = 'verdict'; }
      if (rCopy) { rCopy.disabled = true; }
    }

    function doRedeem() {
      clearOut();
      var res = redeem(rRc ? rRc.value : '', rDev ? rDev.value : '');
      if (!res.ok) {
        showMsg(res.msg, 'bad');
        return;
      }
      current = res;
      if (rAc) { rAc.textContent = res.acFmt; }
      if (rLine) {
        rLine.textContent = '兑换码 ' + res.rcFmt + '（批次 ' + res.batch +
          (res.seq ? ' 第 ' + res.seq + ' 号' : '') + '） · 设备码 ' + res.devFmt;
      }
      if (rVerdict) {
        if (res.selfCheck) {
          rVerdict.className = 'verdict';
          rVerdict.textContent = '已通过本地自校验：该激活码与这台设备绑定。';
        } else {
          rVerdict.className = 'verdict bad';
          rVerdict.textContent = '自校验未通过，请重试或联系商家。';
        }
      }
      if (rOut) { rOut.hidden = false; }
      if (rCopy) { rCopy.disabled = false; }
      showMsg(res.msg, 'good');
    }

    if (rBtn) { rBtn.addEventListener('click', doRedeem); }

    if (rRc) {
      rRc.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && rDev) { rDev.focus(); }
      });
    }
    if (rDev) {
      rDev.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { doRedeem(); }
      });
    }

    if (rClear) {
      rClear.addEventListener('click', function () {
        if (rRc) { rRc.value = ''; }
        if (rDev) { rDev.value = ''; }
        clearOut();
        showMsg('', '');
        if (rRc) { rRc.focus(); }
      });
    }

    if (rCopy) {
      rCopy.addEventListener('click', function () {
        if (!current) { return; }
        copyText(current.acFmt, function (ok) {
          showMsg(ok ? '激活码已复制（' + current.acFmt + '），回到手环激活页粘贴或手输即可。'
                     : '自动复制被浏览器拦下了，请长按上方激活码手动复制。', ok ? 'good' : 'bad');
        });
      });
    }

    /* 供自动化/自检使用，不参与界面逻辑 */
    window.__XM_SITE = {
      core: AC,
      issued: ISSUED,
      digest: ISSUED_DIGEST,
      rent: redeem,
      redeem: doRedeem
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();