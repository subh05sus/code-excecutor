import express from "express";
import http from "http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { executionQueue } from "../queue/executionQueue";
import { pdfQueue } from "../queue/pdfQueue";

export function createBullBoardServer(): http.Server {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/");

  createBullBoard({
    queues: [new BullMQAdapter(executionQueue), new BullMQAdapter(pdfQueue)],
    serverAdapter,
  });

  const app = express();
  app.use("/", serverAdapter.getRouter());

  return app.listen(3001, () => {
    console.log("BullBoard UI listening on port 3001");
  });
}
