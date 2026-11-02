/* 小卖部 · 已发行兑换码的不可逆摘要函数（单源实现）
 * 站点与发码脚本（act-lab/xm_gen_codes.js）共用本文件：
 *   - 站点只保存 500 个兑换码的摘要（sha256 迭代摘要），源码里看不到任何明文兑换码；
 *   - 兑换时用同一个函数算一遍输入码的摘要，再与清单比对。
 * 采用自实现的 SHA-256（纯 32 位运算，不依赖 WebCrypto），迭代 ROUNDS 轮，
 * 使"把 12 位数字空间遍历一遍去撞清单"的代价被放大 ROUNDS 倍。
 */
var ISSUED_DIGEST = (function () {
  'use strict'

  var ROUNDS = 30000
  var PREFIX = 'xiaomaibu-issued-v1|'

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0 }

  function sha256(bytes) {
    var l = bytes.length
    var pl = (((l + 9) + 63) >> 6 << 6)
    var m = new Uint8Array(pl)
    for (var i = 0; i < l; i++) { m[i] = bytes[i] }
    m[l] = 0x80
    var bits = l * 8
    var hi = Math.floor(bits / 4294967296)
    var lo = bits >>> 0
    m[pl - 8] = (hi >>> 24) & 255; m[pl - 7] = (hi >>> 16) & 255
    m[pl - 6] = (hi >>> 8) & 255; m[pl - 5] = hi & 255
    m[pl - 4] = (lo >>> 24) & 255; m[pl - 3] = (lo >>> 16) & 255
    m[pl - 2] = (lo >>> 8) & 255; m[pl - 1] = lo & 255

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
    var w = new Array(64)

    for (var off = 0; off < pl; off += 64) {
      for (var i2 = 0; i2 < 16; i2++) {
        w[i2] = ((m[off + i2 * 4] << 24) | (m[off + i2 * 4 + 1] << 16) |
                 (m[off + i2 * 4 + 2] << 8) | m[off + i2 * 4 + 3]) >>> 0
      }
      for (var i3 = 16; i3 < 64; i3++) {
        var x = w[i3 - 15], y = w[i3 - 2]
        var s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
        var s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0
        w[i3] = (w[i3 - 16] + s0 + w[i3 - 7] + s1) >>> 0
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (var i4 = 0; i4 < 64; i4++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
        var ch = ((e & f) ^ ((~e) & g)) >>> 0
        var t1 = (h + S1 + ch + K[i4] + w[i4]) >>> 0
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
        var mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
        var t2 = (S0 + mj) >>> 0
        h = g; g = f; f = e; e = (d + t1) >>> 0
        d = c; c = b; b = a; a = (t1 + t2) >>> 0
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7]
  }

  function strBytes(s) {
    var out = []
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i)
      if (c < 0x80) { out.push(c) }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)) }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)) }
    }
    return new Uint8Array(out)
  }

  function wordsToBytes(h) {
    var b = new Uint8Array(32)
    for (var i = 0; i < 8; i++) {
      b[i * 4] = (h[i] >>> 24) & 255; b[i * 4 + 1] = (h[i] >>> 16) & 255
      b[i * 4 + 2] = (h[i] >>> 8) & 255; b[i * 4 + 3] = h[i] & 255
    }
    return b
  }

  function bytesToHex(b) {
    var s = ''
    for (var i = 0; i < b.length; i++) {
      s += (b[i] < 16 ? '0' : '') + b[i].toString(16)
    }
    return s
  }

  function norm(rc) { return String(rc === undefined || rc === null ? '' : rc).replace(/[^0-9]/g, '') }

  /* 用同一份 SHA-256 迭代 ROUNDS 轮，输出 64 位十六进制摘要 */
  function digestOf(rc) {
    var h = sha256(strBytes(PREFIX + norm(rc)))
    for (var r = 1; r < ROUNDS; r++) { h = sha256(wordsToBytes(h)) }
    return bytesToHex(wordsToBytes(h))
  }

  return { ROUNDS: ROUNDS, PREFIX: PREFIX, sha256: sha256, digestOf: digestOf }
})()

if (typeof module !== 'undefined' && module.exports) { module.exports = ISSUED_DIGEST }
if (typeof window !== 'undefined') { window.ISSUED_DIGEST = ISSUED_DIGEST }