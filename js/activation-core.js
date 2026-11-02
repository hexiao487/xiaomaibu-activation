/* 小卖部 · 激活核心算法（单源实现 / v2 · 双因子：兑换码 + 设备码）
 * 同一份逻辑同时驱动两端，保证同一「兑换码 + 设备码」在两端得到逐位一致的激活码：
 *   1) 小米手环 Vela 快应用 —— 由 index.ux 内嵌同一份函数体（离线校验，不需要联网）
 *   2) 激活码生成网站       —— 逐字引用本文件（js/activation-core.js）
 * 仅使用 32 位整数运算（自实现 mul32，不依赖 Math.imul），不依赖任何平台 API。
 * 约定：所有中间值均为"无符号 32 位"，凡参与取模（%10 / %97）之前不带符号位。
 *
 * 三类码：
 *   设备码 dev   10 位 = 9 位随机 + 1 位校验      —— 公开因子，手环显示，只负责"绑定目标"
 *   兑换码 rc    12 位 = 批次(2) + 序号(8) + 校验(2) —— 秘密因子，付款后由商家发放
 *   激活码 ac    12 位 = 主体(10) + 校验(2)        —— 由 rc 的批次+序号与 dev 共同派生
 * 缺任一因子都无法得到可用激活码：见 verify 的分支（dev / rc / rcsum / format / acsum / mismatch）。
 */
var AC = (function () {
  'use strict'

  var SALT = 'Xiaomaibu#2026$Vela@1.0-ACT'    /* 仅用于派生 ROUND_K 常量表 */
  var DSALT = 'Xiaomaibu#2026$Vela@1.0-DEV'   /* 设备码 */
  var RSALT = 'Xiaomaibu#2026$Vela@1.0-RDM'   /* 兑换码 */
  var ASALT = 'Xiaomaibu#2026$Vela@1.0-ACT2'  /* 激活码（双因子） */

  var ROUND_K = []

  /* 32 位乘法（低 32 位无符号）：避免依赖 Math.imul，且保证两端一致 */
  function mul32(a, b) {
    a = a >>> 0
    b = b >>> 0
    var al = a & 0xffff
    var ah = (a >>> 16) & 0xffff
    var bl = b & 0xffff
    var bh = (b >>> 16) & 0xffff
    var lo = al * bl
    var mid = ah * bl + al * bh
    return (lo + (mid & 0xffff) * 65536) >>> 0
  }

  function rotl(x, n) {
    n = n & 31
    if (n === 0) { return x >>> 0 }
    return ((x << n) | (x >>> (32 - n))) >>> 0
  }

  /* FNV-1a 变体：每字节异或后再乘质数，并按位置循环左移 */
  function hash32(s, seed) {
    var h = seed >>> 0
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0
      h = mul32(h, 0x01000193)
      h = rotl(h, (i % 7) + 1)
    }
    return h >>> 0
  }

  /* 一轮非线性混合：常量注入 + 三次乘法 + 两次塌缩异或 + 两次变位循环左移 */
  function block(h, i) {
    h = (h ^ ((ROUND_K[i % 6] ^ (i * 0x9E3779B1)) >>> 0)) >>> 0
    h = mul32(h, 0x85EBCA6B)
    h = (h ^ (h >>> 15)) >>> 0
    h = mul32(h, 0xC2B2AE35)
    h = (h ^ (h >>> 13)) >>> 0
    h = rotl(h, (i % 13) + 5)
    h = mul32(h, 0x27D4EB2F)
    h = (h ^ (h >>> 16)) >>> 0
    return rotl(h, (i % 7) + 3)
  }

  for (var r = 0; r < 6; r++) {
    ROUND_K.push(hash32(SALT + '#' + r, mul32(0x9E3779B1 ^ (r * 0x27D4EB2F), 0x85EBCA6B)))
  }

  function clean(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[^0-9]/g, '')
  }

  function normDev(s) { return clean(s) }
  function normAc(s) { return clean(s) }
  function normRc(s) { return clean(s) }

  function fmtDev(d) {
    d = normDev(d)
    return d.length === 10 ? d.slice(0, 5) + '-' + d.slice(5) : d
  }
  function fmtAc(a) {
    a = normAc(a)
    return a.length === 12 ? a.slice(0, 4) + '-' + a.slice(4, 8) + '-' + a.slice(8) : a
  }
  function fmtRc(r) {
    r = normRc(r)
    return r.length === 12 ? r.slice(0, 4) + '-' + r.slice(4, 8) + '-' + r.slice(8) : r
  }

  function padN(n, w) {
    var s = String(n)
    while (s.length < w) { s = '0' + s }
    return s.length > w ? s.slice(s.length - w) : s
  }

  /* ==================== 兑换码 ====================
   * 结构：批次(2 位) + 序号(8 位) + 校验(2 位) = 12 位
   * 校验位是带商家盐的"消息认证码"的截断（模 97），没有盐无法伪造。
   */
  function rcCheck(rcBody) {
    var h = hash32(RSALT + '|' + rcBody, 0x7F4A7C15)
    h = block(h, 41)
    var m = h % 97
    return m < 10 ? '0' + m : String(m)
  }

  function rcFor(batch, seq) {
    var body = padN(batch, 2) + padN(seq, 8)
    return body + rcCheck(body)
  }

  function rcOk(rc) {
    var t = normRc(rc)
    if (t.length !== 12) { return false }
    return rcCheck(t.slice(0, 10)) === t.slice(10)
  }

  /* 拆出批次与序号（用于商家台账核对） */
  function rcInfo(rc) {
    var t = normRc(rc)
    if (!rcOk(t)) { return null }
    return { batch: t.slice(0, 2), seq: t.slice(2, 10) }
  }

  /* ==================== 激活码（双因子） ====================
   * 输入 = 兑换码的"批次+序号"（10 位） + 设备码（10 位）
   * 输出 = 主体(10 位) + 校验(2 位) = 12 位
   */
  function bodyOf(rcBody, d) {
    var h = hash32(ASALT + '|' + rcBody, 0x2545F491)
    for (var i = 0; i < 6; i++) { h = block(h, i + 40) }
    var g = hash32(ASALT + '|' + d + '|' + rcBody, h)
    h = mul32((h ^ g) >>> 0, 0x9E3779B1)
    h = block(h, 61)
    var out = ''
    var x = h
    for (var j = 0; j < 10; j++) {
      x = block(x, 70 + j * 3)
      out += String(x % 10)
    }
    return out
  }

  function checkOf(rcBody, d, body) {
    var h = hash32(RSALT + '|' + rcBody + '|' + d + '|' + body, 0x811C9DC5)
    h = block(h, 88)
    var m = h % 97
    return m < 10 ? '0' + m : String(m)
  }

  function acFor(rc, dev) {
    var r = normRc(rc)
    var d = normDev(dev)
    if (r.length !== 12 || d.length !== 10) { return '' }
    var rb = r.slice(0, 10)
    var body = bodyOf(rb, d)
    return body + checkOf(rb, d, body)
  }

  function verify(rc, dev, ac) {
    var r = normRc(rc)
    var d = normDev(dev)
    var a = normAc(ac)
    if (d.length !== 10) { return { ok: false, reason: 'dev' } }
    if (r.length !== 12) { return { ok: false, reason: 'rc' } }
    if (rcCheck(r.slice(0, 10)) !== r.slice(10)) { return { ok: false, reason: 'rcsum' } }
    if (a.length !== 12) { return { ok: false, reason: 'format' } }
    if (acFor(r, d) === a) { return { ok: true, reason: 'ok' } }
    if (checkOf(r.slice(0, 10), d, a.slice(0, 10)) !== a.slice(10)) { return { ok: false, reason: 'acsum' } }
    return { ok: false, reason: 'mismatch' }
  }

  /* ==================== 设备码 ==================== */
  /* 设备码第 10 位校验位：9 位随机串 + 1 位校验，防手抄错 */
  function devCheck(d9) {
    var s = 0
    for (var i = 0; i < d9.length; i++) {
      s = (s * 7 + (d9.charCodeAt(i) - 48) * (i + 3)) % 101
    }
    return String((s * 3 + 11) % 10)
  }

  function makeDev(seedStr) {
    var h = hash32(DSALT + '|' + seedStr, 0x1F123BB5)
    var out = ''
    for (var i = 0; i < 9; i++) {
      h = block(h, 100 + i)
      out += String(h % 10)
    }
    return out + devCheck(out)
  }

  var seq = 0

  /* 首次启动在设备上生成设备码：随机源 + 时间 + 序号，随后持久化到本地存储 */
  function genDev() {
    var a = 0
    var b = 0
    try { a = Math.floor(Math.random() * 4294967296) >>> 0 } catch (e) { a = 0 }
    try { b = (Date.now() % 4294967296) >>> 0 } catch (e) { b = 0 }
    seq = (seq + 1) % 100000
    var s = String(a) + '|' + String(b) + '|' + String(seq)
    return makeDev(s)
  }

  function devOk(d) {
    var t = normDev(d)
    if (t.length !== 10) { return false }
    return devCheck(t.slice(0, 9)) === t.slice(9)
  }

  return {
    mul32: mul32,
    hash32: hash32,
    rcFor: rcFor,
    rcOk: rcOk,
    rcInfo: rcInfo,
    rcCheck: rcCheck,
    checkOf: checkOf,
    acFor: acFor,
    verify: verify,
    genDev: genDev,
    makeDev: makeDev,
    devOk: devOk,
    fmtDev: fmtDev,
    fmtAc: fmtAc,
    fmtRc: fmtRc,
    normDev: normDev,
    normAc: normAc,
    normRc: normRc,
    SALT: SALT,
    RSALT: RSALT
  }
})()
if (typeof module !== 'undefined' && module.exports) { module.exports = AC }
