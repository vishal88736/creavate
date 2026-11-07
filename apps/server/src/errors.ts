import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { AppError } from "@creavate/shared";

export function describeError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof AppError)
    return { status: error.status, message: error.message };
  if (error instanceof z.ZodError)
    return { status: 400, message: "Request validation failed" };
  // Express's body parser includes the original submitted body in its error.
  // Classify only its known type; never return or log that body or raw message.
  const type =
    error && typeof error === "object" && "type" in error
      ? error.type
      : undefined;
  if (type === "entity.parse.failed")
    return { status: 400, message: "Request body must be valid JSON" };
  if (type === "entity.too.large")
    return { status: 413, message: "Request body exceeds the 1 MB limit" };
  if (type === "encoding.unsupported" || type === "charset.unsupported")
    return { status: 415, message: "Request body encoding is not supported" };
  if (type === "request.aborted" || type === "request.size.invalid")
    return { status: 400, message: "Request body was incomplete" };
  return {
    status: 500,
    message:
      "The request failed. Check server logs and account connection status.",
  };
}

export const handleError: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, message } = describeError(error);
  const entry = JSON.stringify({
    level: status >= 500 ? "error" : "warn",
    type: error instanceof Error ? error.name : "Error",
    status,
    method: req.method,
    path: req.path,
    message:
      status >= 500 && !(error instanceof AppError)
        ? "Internal server error"
        : message,
  });
  if (status >= 500) console.error(entry);
  else console.warn(entry);
  res.status(status).json({ error: message });
};
