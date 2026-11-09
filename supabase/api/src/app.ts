import express, { type Express } from "express";
import cors from "cors";
import { env } from "./env.js";
import { errorHandler } from "./http.js";
import { authRouter } from "./routes/auth.js";
import { profilesRouter } from "./routes/profiles.js";
import { usersRouter } from "./routes/users.js";
import { locationsRouter } from "./routes/locations.js";
import { itemsRouter } from "./routes/items.js";
import { stockRouter } from "./routes/stock.js";
import { movementsRouter } from "./routes/movements.js";
import { reservationsRouter } from "./routes/reservations.js";
import { directPurchasesRouter } from "./routes/directPurchases.js";
import { paymentsRouter } from "./routes/payments.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { reportsRouter } from "./routes/reports.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { adminRouter } from "./routes/admin.js";
import { devicesRouter } from "./routes/devices.js";

// X-Process-Time header middleware — measures total request latency.
// Must set the header BEFORE the response is flushed. Patching res.end (not
// listening to res.on('finish')) because 'finish' fires after headers are sent,
// and setHeader there throws ERR_HTTP_HEADERS_SENT and crashes the process.
function processTimeMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);
  res.end = ((...args: Parameters<typeof originalEnd>) => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (!res.headersSent) {
      res.setHeader("X-Process-Time", elapsedMs.toFixed(2));
    }
    return originalEnd(...args);
  }) as typeof res.end;
  next();
}

export function createApp(): Express {
  const app = express();

  // Trust Railway's reverse proxy so express-rate-limit reads the real
  // client IP from X-Forwarded-For rather than the internal load-balancer.
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(processTimeMiddleware);

  // Liveness probe — no auth.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "inventory-api" });
  });

  // Unauthenticated — UrubutoPay's servers call this directly, no session JWT.
  // Mounted before the payments router so it never passes through
  // requireAuth/requirePaymentAccess.
  app.use("/webhooks", webhooksRouter);

  app.use("/auth", authRouter);
  app.use("/profiles", profilesRouter);
  app.use("/users", usersRouter);
  app.use("/locations", locationsRouter);
  app.use("/items", itemsRouter);
  app.use("/stock", stockRouter);
  app.use("/movements", movementsRouter);
  app.use("/reservations", reservationsRouter);
  app.use("/direct-purchases", directPurchasesRouter);
  app.use("/payments", paymentsRouter);
  app.use("/reports", reportsRouter);
  app.use("/suggestions", suggestionsRouter);
  app.use("/devices", devicesRouter);
  app.use("/admin", adminRouter);

  // 404 for anything unmatched.
  app.use((_req, res) => {
    res.status(404).json({ error: { message: "Route not found.", code: "not_found" } });
  });

  app.use(errorHandler);

  return app;
}
