import express from "express";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

/**
 * Save HTML to disk.
 * @param {string} targetDir - directory where HTML will be saved
 * @param {string} elementSelector - CSS selector for specific element to export; if falsy exports whole page
 * @param {import('playwright').Page} page - Playwright Page instance to export from
 */
async function savePageHtml(targetDir, elementSelector, page) {
  if (!page) {
    console.warn("savePageHtml: no page provided to export");
    return;
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    console.warn("savePageHtml: could not create targetDir", targetDir, e && e.message);
  }

  try {
    let html;
    if (elementSelector) {
      const handle = await page.$(elementSelector);
      if (handle) {
        // outerHTML gives the element and its children
        html = await handle.evaluate((el) => el.outerHTML);
      } else {
        console.warn(`savePageHtml: selector '${elementSelector}' not found, falling back to full page`);
        html = await page.content();
      }
    } else {
      html = await page.content();
    }

    const filename = elementSelector
      ? `processed-element-${Date.now()}.html`
      : `processed-page-${Date.now()}.html`;
    const outPath = path.join(targetDir, filename);
    fs.writeFileSync(outPath, html, "utf8");
    console.log("➡️ HTML salvo em:", outPath);
  } catch (e) {
    console.warn("savePageHtml: failed to write html:", e && e.message);
  }
}

/**
 * Captura e salva um screenshot garantindo que o diretório exista.
 * @param {string} targetDir - diretório onde o screenshot será salvo
 * @param {string} filename - nome do arquivo (ex.: lattes_dashboard.png)
 * @param {import('playwright').Page} page - instância do Playwright Page
 * @param {import('playwright').PageScreenshotOptions} [options]
 * @returns {Promise<string|null>} caminho final do arquivo ou null em caso de erro
 */
async function saveScreenshot(targetDir, filename, page, options = {}) {
  if (!page) {
    console.warn("saveScreenshot: no page provided to capture");
    return null;
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    console.warn("saveScreenshot: could not create targetDir", targetDir, e && e.message);
  }

  const outPath = path.join(targetDir, filename || `screenshot-${Date.now()}.png`);
  try {
    await page.screenshot({ fullPage: true, ...options, path: outPath });
    console.log("➡️ Screenshot salvo em:", outPath);
    return outPath;
  } catch (e) {
    console.warn("saveScreenshot: failed to take screenshot:", e && e.message);
    return null;
  }
}

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

    // garante diretório de screenshots e tira screenshot
    const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/app/screenshots";
    await saveScreenshot(SCREENSHOT_DIR, "lattes_dashboard.png", page);

    return { browser, page };
  } catch (err) {
    console.error("Erro durante login:", err);
    await browser.close();
    throw err;
  }
}

// ====== FUNÇÃO: ATUALIZAR LATTES ======
async function atualizarLattes(articles = []) {
  const { browser, page } = await loginLattes();

  try {
    const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/app/screenshots";
    
    console.log(`📚 Recebi ${articles.length} artigos para processar.`);
    
    // Helper para pegar um iframe pelo trecho do src
    const getFrameBySrc = async (partial) => {
        const iframeHandle = await page.waitForSelector(
        `iframe[src*="${partial}"]`,
        { timeout: 60000 }
    );
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
        throw new Error(`Não consegui acessar iframe com src contendo ${partial}`);
        }
        return frame;
    };
    // Abre menu Produções após o login
    console.log("➡️ Mantendo o mouse em cima de menu 'Produções'…");
    await page.waitForSelector("a:has-text(\"Produções\")", {
        timeout: 60000,
        state: "visible",
    });
    await page.hover("a:has-text(\"Produções\")")
    await page.waitForSelector('#megamenu6 a:has-text("Trabalhos publicados em anais de eventos")', {
        timeout: 60000,
        state: "visible",
    }); // aguarda o submenu carregar

    
    console.log("➡️ clicando em 'Trabalhos publicados em anais de eventos'…");
    await page.click('#megamenu6 a:has-text("Trabalhos publicados em anais de eventos")');

    // Garante que a lista de trabalhos carregou em um iframe
    const listaFrame = await getFrameBySrc("pkg_trabalho.lista");

    // Para cada artigo que tenha conference, entra em "Trabalhos publicados em anais de eventos"
    for (const art of articles) {
        if (!art.conference) {
        throw new Error(
            `Artigo sem campo citation/conference: "${art.title || "sem título"}"`
        );
        }

        console.log(
        "➡️ Abrindo 'Trabalhos publicados em anais de eventos' para:",
        art.title
        );
        // Dentro da lista, clicar em "Incluir novo item" para abrir o formulário
        await listaFrame.waitForSelector("a:has-text(\"Incluir novo item\")", {
            timeout: 60000,
            state: "visible",
        });
        await Promise.all([
            page.waitForLoadState("networkidle"),
            listaFrame.click("a:has-text(\"Incluir novo item\")"),
        ]);


        const formFrame = await getFrameBySrc("pkg_trabalho.form");

        const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/app/screenshots";
        await savePageHtml(SCREENSHOT_DIR, null, listaFrame);
        await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_antes.png", page);
        // Preenche campos principais do formulário "Trabalhos publicados em anais de eventos"
        if (art.doi != null) {
            await formFrame.fill('input[name="f_cod_doi"]', art.doi || "");
            console.log("✏️ Preenchendo DOI");
            await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_doied.png", page);
            console.log(
                "✏️ DOI preenchido. A partir disso, os seguites campos são preenchidos automaticamente:\n"+
                "\t- Título da publicação\n"+
                "\t- Ano do evento\n"+
                "\t- Nome do evento\n"+
                "\t- Cidade do evento\n"+
                "\t- Autores\n"+
                "\t- Idioma\n"
            );
        } else {
                console.log("✏️ Preenchendo informações manualmente pois não há DOI.");
                // Título
                await formFrame.fill('input[name="f_titulo"]', art.title || "");
                console.log("✏️ Preenchendo título");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_titled.png", page);
                // Ano de publicação
                await formFrame.fill('input[name="f_ano"]', art.publication_date);
                console.log("✏️ Preenchendo ano");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_yeared.png", page);
                // Nome do evento
                await formFrame.fill('input[name="f_evento"]', art.conference || "");
                console.log("✏️ Preenchendo nome do evento");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_evented.png", page);
                // Ano do evento
                await formFrame.fill('input[name="f_ano_evento"]', art.publication_date);
                console.log("✏️ Preenchendo ano do evento");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_event_yeared.png", page);
                // Cidade do evento
                await formFrame.fill('input[name="f_cidade_evento"]', "");
                console.log("✏️ Preenchendo cidade do evento");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_citied.png", page);
                // Título da publicação
                await formFrame.fill('input[name="f_titulo_pub"]', art.conference || "");
                await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_title_pubed.png", page);
                console.log("✏️ Preenchendo título da publicação");
            }
        const paginas = (art.pages || "").split(/[-–]/).map((p) => p.trim());
        const paginaInicial = paginas[0] || "";
        const paginaFinal = paginas[1] || "";
        if (paginaInicial) await formFrame.fill('input[name="f_pag_ini"]', paginaInicial);
        if (paginaFinal) await formFrame.fill('input[name="f_pag_fim"]', paginaFinal);

        // Natureza: marcar "Completo" por padrão
        console.log("✏️ Marcando natureza como Completo");
        await formFrame.check('input[name="F_COD_PROD"][value="121"]');

        // País de publicação: manter Brasil, valor já selecionado ("BRA"). Se o HTML mudar, ajuste aqui.

        // Salvar
        console.log("💾 Salvando formulário");
        await formFrame.click('a:has-text("Salvar")');
        await page.waitForLoadState("networkidle");
        await saveScreenshot(SCREENSHOT_DIR, "lattes_anais_de_eventos_saved.png", page);
    }
    // Fecha o modal de "Trabalhos publicados em anais de eventos" // ???: verificar se funciona
    const producoesModal = page
        .locator(".win-wrapper")
        .filter({
            has: page.locator('.win-title:has-text("Trabalhos publicados em anais de eventos")'),
        });
    if (await producoesModal.count()) {
    await producoesModal.locator(".tool.close").click();
    await page.waitForSelector("iframe[src*='pkg_trabalho.lista']", { state: "detached" });
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

    // save screenshot to configured screenshots dir
    const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/app/screenshots";
    await saveScreenshot(SCREENSHOT_DIR, "lattes_dashboard.png", page);

    await browser.close();

    return res.json({
      ok: true,
      currentUrl,
      title,
      screenshot: "lattes_dashboard.png",
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
        doi: c.doi,
      };
    });

    if (articles.length === 0) {
      return res.status(400).json({
        error: "Nenhum artigo encontrado no payload.",
      });
    }

    // Aqui chamamos o Playwright para logar e inserir os artigos
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

// endpoint to serve the screenshot (if present)
app.get("/screenshot", (req, res) => {
  const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/app/screenshots";
  const screenshotPath = path.join(SCREENSHOT_DIR, "lattes_dashboard.png");
  if (!fs.existsSync(screenshotPath)) {
    return res.status(404).json({ ok: false, error: "screenshot not found" });
  }
  return res.sendFile(screenshotPath);
});
