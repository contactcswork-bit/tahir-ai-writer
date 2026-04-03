import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the deployment proxy (required for rate limiting and X-Forwarded-For in production)
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Managed by frontend
    crossOriginEmbedderPolicy: false,
  })
);

// CORS: allow all origins — every endpoint requires JWT auth so CORS is not a security boundary
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Global rate limit: high ceiling to prevent abuse without blocking real usage
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
});
app.use(globalLimiter);

// Stricter rate limit for auth routes: 20 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts — try again in 15 minutes." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);


app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// 404 handler for unknown API routes (Express 5 wildcard syntax)
app.use("/api/{*path}", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// Global error handler — catches any unhandled error thrown/passed via next(err)
// Must have 4 parameters for Express to treat it as error middleware
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;

  // Build a human-readable message
  let message = err.message || "Internal server error";

  // Drizzle / PostgreSQL errors
  if (err.code === "23505") message = "A record with this value already exists";
  if (err.code === "23503") message = "Cannot delete — other records depend on this item";
  if (err.code === "23502") message = "A required field is missing";
  if (err.code === "42P01") message = "Database table not found — please contact support";
  if (err.name === "ZodError") {
    const issues = err.errors?.map((e: any) => `${e.path.join(".")}: ${e.message}`).join("; ");
    message = `Validation error — ${issues || err.message}`;
  }

  logger.error(
    { err, status, method: req.method, url: req.url?.split("?")[0] },
    "Unhandled route error"
  );

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

export default app;
