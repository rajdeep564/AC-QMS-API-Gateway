import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { requestLogger } from "./middleware/request-logger";
import apiRouter from "./routes";
import { ok } from "./lib/api-response";

const app = express();

app.set("trust proxy", 1);
app.use(requestLogger);
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json(ok({ status: "ok" }));
});

app.use("/api/v1", apiRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
