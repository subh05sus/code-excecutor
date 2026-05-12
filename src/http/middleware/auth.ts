import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../../config/env";

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-internal-token"];

  if (!token || typeof token !== "string") {
    res.status(401).json({ error: "Missing X-Internal-Token header" });
    return;
  }

  const expected = Buffer.from(config.internalToken);
  const provided = Buffer.from(token);

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    res.status(401).json({ error: "Invalid internal token" });
    return;
  }

  next();
}
