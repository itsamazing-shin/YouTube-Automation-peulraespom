import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const outputDir = path.join(process.cwd(), "output");
app.use("/api/files", express.static(outputDir));

app.use("/api", router);

export default app;
