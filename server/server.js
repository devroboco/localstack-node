import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { lookup as mimeLookup } from "mime-types";

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

import path from "node:path";
import { Readable } from "node:stream";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

const {
  PORT = 3000,
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_ENDPOINT,
  S3_BUCKET,
  DDB_TABLE,
  JWT_SECRET,
} = process.env;

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
  endpoint: AWS_ENDPOINT,
  forcePathStyle: true,
});

const ddb = new DynamoDBClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
  endpoint: AWS_ENDPOINT,
});
const ddbDoc = DynamoDBDocumentClient.from(ddb);

const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const key = `${Date.now()}_${req.file.originalname}`;
    const contentType =
      req.file.mimetype ||
      mimeLookup(req.file.originalname) ||
      "application/octet-stream";

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: contentType,
      })
    );

    res.json({ ok: true, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha no upload" });
  }
});

app.get("/api/files", async (_req, res) => {
  try {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
      })
    );

    const items = (out.Contents || []).map((o) => ({
      key: o.Key,
      size: o.Size,
      lastModified: o.LastModified,
    }));

    res.json({ ok: true, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao listar arquivos" });
  }
});

app.get("/api/download/:key", async (req, res) => {
  try {
    const key = req.params.key;
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      })
    );

    const contentType = out.ContentType || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(key)}"`
    );

    const bodyStream = out.Body;
    if (bodyStream instanceof Readable) {
      bodyStream.pipe(res);
    } else {
      res.send(Buffer.from(await out.Body.transformToByteArray()));
    }
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: "Arquivo não encontrado" });
  }
});

app.post("/api/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Informe email e senha" });

    const passwordHash = await bcrypt.hash(password, 10);

    await ddbDoc.send(
      new PutCommand({
        TableName: DDB_TABLE,
        Item: {
          email: email.toLowerCase(),
          name: name || null,
          passwordHash,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(email)",
      })
    );

    res.json({ ok: true, message: "Usuário criado" });
  } catch (err) {
    if (String(err).includes("ConditionalCheckFailed")) {
      return res.status(409).json({ error: "Email já cadastrado" });
    }
    console.error(err);
    res.status(500).json({ error: "Falha ao criar usuário" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Informe email e senha" });

    const out = await ddbDoc.send(
      new GetCommand({
        TableName: DDB_TABLE,
        Key: { email: email.toLowerCase() },
      })
    );

    const user = out.Item;
    if (!user) return res.status(401).json({ error: "Credenciais inválidas" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });

    const token = jwt.sign({ sub: user.email }, JWT_SECRET, {
      expiresIn: "2h",
    });
    res.json({ ok: true, token, user: { email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha ao autenticar" });
  }
});

app.get("/api/me", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Token ausente" });

    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok: true, me: payload.sub });
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
});

app.listen(PORT, () => {
  console.log(`Server rodando em http://localhost:${PORT}`);
});
