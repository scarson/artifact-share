import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

// Spec §9: "/" is deliberately neutral/blank — nothing to enumerate.
app.get("/", (c) => c.body(null, 200));

export default app;
