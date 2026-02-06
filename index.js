import express from "express";
import crypto from "crypto";
import * as line from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  TOM_USER_ID,
  FORM_URL
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing env: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET");
  process.exit(1);
}

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

const app = express();

// LINE署名検証しつつ raw body を使いたいので verify を仕込む
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    }
  })
);

app.get("/", (_req, res) => res.status(200).send("ok"));

function validateSignature(req) {
  const signature = req.get("x-line-signature");
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

app.post("/webhook", async (req, res) => {
  try {
    if (!validateSignature(req)) {
      return res.status(401).send("invalid signature");
    }

    const events = req.body?.events ?? [];

    for (const ev of events) {
      // まずは userId をログ出し（最初の1回用）
      const senderUserId = ev?.source?.userId;
      const where = ev?.source?.type; // "group" | "room" | "user"
      if (senderUserId) {
        console.log("[senderUserId]", senderUserId, "where:", where);
      }

      // メッセージイベント以外は無視
      if (ev.type !== "message") continue;
      if (ev.message?.type !== "text") continue;

      const text = ev.message.text || "";
      const trigger = text.includes("おめでとうございます");

      // ★ tom本人だけに反応
      const isTom = TOM_USER_ID && senderUserId === TOM_USER_ID;

      if (trigger && isTom) {
        const url = FORM_URL || "(FORM_URL が未設定です)";

        // tomの個チャにだけ送る（グループ等には返信しない）
        await client.pushMessage({
          to: senderUserId,
          messages: [
            {
              type: "text",
              text: `📌進捗トリガー検知！\nフォームはこちら👇\n${url}`
            }
          ]
        });

        console.log("Pushed form URL to tom.");
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port", port));
