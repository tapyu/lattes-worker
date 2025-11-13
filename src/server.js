import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

// healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// smoke test: abre o site do Lattes e retorna o título
app.get("/smoke", async (req, res) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://lattes.cnpq.br/");
  const title = await page.title();
  await browser.close();
  res.json({ title });
});

// endpoint que o n8n vai chamar (por enquanto só valida entrada)
app.post("/lattes/atualizar", async (req, res) => {
  const { articles } = req.body || {};
  if (!Array.isArray(articles)) {
    return res.status(400).json({ error: "articles[] é obrigatório" });
  }
  // Próximos passos: enfileirar e processar com Playwright
  return res.status(202).json({ status: "queued", received: articles.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on :${PORT}`));

