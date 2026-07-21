import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import sitesRouter from "./routes/sites.js";
import reservationsRouter from "./routes/reservations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

app.get("/api/config", (req, res) => {
  res.json({
    squareApplicationId: process.env.SQUARE_APPLICATION_ID ?? null,
    squareLocationId: process.env.SQUARE_LOCATION_ID ?? null,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
  });
});

app.use("/api", sitesRouter);
app.use("/api/reservations", reservationsRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Wagon Wheel RV Park server listening on port ${port}`);
});
