import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

// ====== CREDENCIAIS NAS VARIÁVEIS DE AMBIENTE ======
const LATTES_CPF = process.env.LATTES_CPF;
const LATTES_PASSWORD = process.env.LATTES_PASSWORD;

if (!LATTES_CPF || !LATTES_PASSWORD) {
  console.warn(
    "⚠️ LATTES_CPF ou LATTES_PASSWORD não definidos nas variáveis de ambiente."
  );
}

// ====== FUNÇÃO: FAZ LOGIN NO LATTES VIA CPF (SSO CNPq) ======
async function loginLattes() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("➡️ Abrindo página de login do Lattes (pkg_login.prc_form)…");

    // Antes de carregar, prepara o handler do popup "Você será redirecionado..."
    page.once("dialog", async (dialog) => {
      console.log("⚠️ Dialog apareceu:", dialog.message());
      await dialog.accept();
    });

    // URL que corresponde a "Atualizar currículo"
    await page.goto("https://wwws.cnpq.br/cvlattesweb/pkg_login.prc_form", {
      waitUntil: "load",
    });

    console.log("➡️ Aguardando redirecionar para login.cnpq.br (tela CPF)…");
    await page.waitForURL(
      /login\.cnpq\.br\/auth\/realms\/cnpq\/protocol\/openid-connect\/auth.*/,
      { timeout: 30000 }
    );

    // ===== Tela do CPF =====
    console.log("✏️ Preenchendo CPF…");
    await page.waitForSelector("#accountId", { timeout: 15000 });
    await page.fill("#accountId", LATTES_CPF);

    console.log("➡️ Enviando CPF (botão Continue)…");
    await Promise.all([
      page.click("#kc-login"),
      page.waitForNavigation({ waitUntil: "networkidle" }),
    ]);

    // ===== Tela da senha =====
    console.log("➡️ Aguardando tela da senha…");
    await page.waitForURL(
      /login\.cnpq\.br\/auth\/realms\/cnpq\/login-actions\/authenticate.*/,
      { timeout: 30000 }
    );

    console.log("✏️ Preenchendo senha…");
    await page.waitForSelector("#password", { timeout: 15000 });
    await page.fill("#password", LATTES_PASSWORD);

    console.log("➡️ Enviando senha (botão Entrar)…");
    await Promise.all([
      page.click("#kc-login"),
      page.waitForNavigation({ waitUntil: "networkidle" }),
    ]);

    // ===== Página do Currículo Lattes =====
    console.log("➡️ Aguardando página do Currículo Lattes…");
    await page.waitForURL(
      /wwws\.cnpq\.br\/cvlattesweb\/PKG_MENU\.menu.*/,
      { timeout: 30000 }
    );

    console.log("✅ Login no Lattes concluído com sucesso.");
    return { browser, page };
  } catch (err) {
    console.error("❌ Erro durante login no Lattes:", err);
    await browser.close();
    throw err;
  }
}

// ====== FUNÇÃO: ATUALIZAR LATTES (POR ENQUANTO SÓ LOGIN + PRINT) ======
async function atualizarLattes(articles = []) {
  const { browser, page } = await loginLattes();

  try {
    console.log(`📚 Recebi ${articles.length} artigos para processar.`);

    // META INICIAL: apenas tirar um print da página logada
    await page.screenshot({
      path: "lattes-dashboard.png",
      fullPage: true,
    });
    console.log("📸 Screenshot salvo como lattes-dashboard.png");

    // Futuro: aqui a gente navega até Produções e cadastra cada artigo.
    for (const art of articles) {
      console.log("Simulando cadastro de artigo:", art.title);
      // TODO: implementar clicks/preenchimento real nos formulários do Lattes
    }
  } finally {
    await browser.close();
  }
}

// -------------------- healthcheck --------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// -------------------- smoke test --------------------
app.get("/smoke", async (req, res) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://lattes.cnpq.br/");
  const title = await page.title();
  await browser.close();
  res.json({ title });
});

// -------------------- login-teste --------------------
app.get("/login-teste", async (req, res) => {
  try {
    const { browser, page } = await loginLattes();
    const currentUrl = page.url();
    const title = await page.title();

    await page.screenshot({
      path: "lattes-dashboard.png",
      fullPage: true,
    });

    await browser.close();

    return res.json({
      ok: true,
      currentUrl,
      title,
      screenshot: "lattes-dashboard.png",
    });
  } catch (err) {
    console.error("Erro em /login-teste:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
});

// -------- endpoint que o n8n vai chamar --------
app.post("/lattes/atualizar", async (req, res) => {
  try {
    const payload = req.body;

    // O n8n SEMPRE envia um array
    if (!Array.isArray(payload)) {
      return res.status(400).json({
        error: "O corpo da requisição deve ser um array de objetos SerpAPI.",
      });
    }

    // Converte o array bruto → estrutura simplificada p/ o Lattes
    const articles = payload.map((item) => {
      const c = item.citation || {};
      const firstResource = Array.isArray(c.resources) ? c.resources[0] : null;

      return {
        title: c.title,
        link: c.link,
        pdf: firstResource?.link || null,
        authors: c.authors,
        publication_date: c.publication_date,
        conference: c.conference,
        pages: c.pages,
        description: c.description,
      };
    });

    if (articles.length === 0) {
      return res.status(400).json({
        error: "Nenhum artigo encontrado no payload.",
      });
    }

    // Aqui chamamos o Playwright para logar e (por enquanto) só tirar print
    await atualizarLattes(articles);

    return res.status(200).json({
      status: "ok",
      processed: articles.length,
    });
  } catch (err) {
    console.error("Erro ao atualizar Lattes:", err);
    return res.status(500).json({
      status: "error",
      message: "Falha ao atualizar Lattes",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on :${PORT}`));
