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
  const browser = await chromium.launch({
    headless: true,          // coloque false para debugar localmente
    slowMo: 150,          // descomente para ver melhor (fora do docker)
  });

  const portalPage = await browser.newPage();

  try {
    // 1) Abre a home do Lattes
    console.log("➡️ Abrindo https://memoria.cnpq.br/web/portal-lattes/ …");
    await portalPage.goto("https://memoria.cnpq.br/web/portal-lattes/", {
      waitUntil: "domcontentloaded",
    });

    // 2) Qualquer alerta que aparecer (incluindo o “Você será redirecionado…”)
    portalPage.on("dialog", async (dialog) => {
      console.log("⚠️ Dialog:", dialog.message());
      await dialog.accept();
    });

    // 3) Clica em “Atualizar currículo” (abre nova aba/guia)
    const [page] = await Promise.all([
      portalPage.context().waitForEvent("page").then((newPage) => {
        console.log("➡️ Nova aba aberta a partir de 'Atualizar currículo'");
        return newPage;
      }),
      portalPage.click("text=Atualizar currículo"),
    ]);
    await page.waitForLoadState("load");

    console.log("➡️ URL após clique em 'Atualizar currículo':", page.url());

    // 4) Espera a nova aba carregar (pode ser wwws.cnpq.br ou login.cnpq.br)
    console.log("➡️ Aguardando tela do CPF …");
    await page.waitForURL(/(wwws\.cnpq\.br|login\.cnpq\.br)/, {
      timeout: 60000,
    });
    console.log("➡️ URL da tela do CPF:", page.url());
    
    // ===== Tela do CPF =====
    await page.waitForSelector("#accountId", { timeout: 15_000 });
    console.log("➡️ URL tela CPF em que #accountId se encontra:", page.url());
    console.log("✏️ Preenchendo CPF...");
    await page.fill("#accountId", LATTES_CPF);

    await Promise.all([
      page.click("#kc-login"), // botão "Continue"
      page.waitForURL(
        /login\.cnpq\.br\/auth\/realms\/cnpq\/login-actions\/authenticate/,
        { 
            timeout: 60_000,
         },
      ),
    ]);

    // ===== Tela da senha =====
    console.log(
      "➡️ Aguardando tela da senha em",
      page.url(),
      "selector: #password"
    );
    
    // A tela de senha pode demorar a renderizar; espera até ficar visível
    try {
      await page.waitForSelector("#password", { timeout: 60_000, state: "visible" });
    } catch (err) {
      const html = await page.content();
      console.error("❌ Não achei #password. URL:", page.url());
      console.error("HTML:", html);
      throw err;
    }
    console.log("➡️ URL tela senha em que #password se encontra:", page.url());
    console.log("✏️ Preenchendo senha…");
    await page.fill("#password", LATTES_PASSWORD);

    await Promise.all([
      page.click("#kc-login"), // botão "Entrar"
      page.waitForURL(/cvlattesweb\/PKG_MENU\.menu/, {
        timeout: 60000,
      }),
    ]);

    // ===== Currículo Lattes =====
    console.log("✅ Login concluído. URL final:", page.url());

    // aqui você poderia tirar screenshot se quiser:
    await page.screenshot({ path: "lattes-dashboard.png", fullPage: true });

    return { browser, page };
  } catch (err) {
    console.error("Erro durante login:", err);
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
