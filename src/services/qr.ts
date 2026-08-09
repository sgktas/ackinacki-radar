import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Vendored copy of kazuhikoarase/qrcode-generator (MIT), base encoder + the
// UTF-8 string-to-bytes patch, concatenated with a trailing `module.exports`
// — see /root or the repo for provenance. No network dependency, no canvas:
// its GIF encoder is pure JS, which is why it works in a plain Node process.
const qrcode = require("./vendor/qrcode-generator.cjs");

// AN Wallet's deep_link only ever opens something on the device it's tapped
// on, and AN Wallet is mobile-only. A user chatting with the bot from
// Telegram Desktop (or the dashboard, on a PC) has nothing on that machine to
// catch the link — the approval step itself must happen on the phone
// regardless, so the practical fix is making the link easy to GET onto a
// phone: show it as a QR code they scan with the phone's camera.
//
// This mirrors the same fix already shipped on the web dashboard
// (public/qrcode.js + makeQrSvg) — same library, same auto-size loop — but
// produces a GIF buffer here since Telegram's Bot API takes an image
// upload, not inline SVG.
export function makeQrGifBuffer(text: string): Buffer | null {
  for (let type = 2; type <= 20; type += 1) {
    try {
      const qr = qrcode(type, "M");
      qr.addData(text);
      qr.make();

      const dataUrl: string = qr.createDataURL(6, 4);
      const base64 = dataUrl.split(",")[1] ?? "";
      return Buffer.from(base64, "base64");
    } catch {
      // "code length overflow" — try the next size up.
    }
  }

  return null;
}
