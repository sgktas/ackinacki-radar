import "dotenv/config";
import { startServer } from "./server";
import { startBot } from "./bot";

async function main() {
  const botToken = process.env.BOT_TOKEN;
  const port = Number(process.env.PORT || 3000);

  if (!botToken) {
    throw new Error("BOT_TOKEN bulunamadı. .env dosyasını kontrol et.");
  }

  startServer(port);
  await startBot(botToken);
}

main().catch((error) => {
  console.error("Uygulama başlatılamadı:", error);
  process.exit(1);
});