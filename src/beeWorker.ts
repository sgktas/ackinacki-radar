import "dotenv/config";
import { startBeeWorker } from "./bot";

try {
  startBeeWorker();
} catch (error) {
  console.error("Bee worker failed to start:", error);
  process.exit(1);
}
