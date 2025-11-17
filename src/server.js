import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

// >>>>>> AQUI: credenciais vindas das variáveis de ambiente <<<<<<
const LATTES_USERNAME = process.env.LATTES_USERNAME;
const CPF = process.env.CPF;

if (!LATTES_USERNAME || !CPF) {
  console.warn(
    "⚠️ LATTES_USERNAME ou CPF não definidos nas variáveis de ambiente."
  );
}

// -------- função que realmente loga no Lattes e cadastra artigos --------
async function atualizarLattes(articles = []) {
  // abre navegador headless
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1) abre página inicial do Lattes
    await page.goto("https://lattes.cnpq.br/", { waitUntil: "networkidle" });

    // 2) NAVEGA ATÉ A TELA DE LOGIN
    // ⚠️ Os seletores abaixo são EXEMPLOS. Você precisa abrir o Lattes no navegador,
    // inspecionar o HTML e trocar por seletores reais.
    //
    // Exemplo: clicar em "Atualizar Currículo" ou equivalente:
    // await page.click("text=Atualizar Currículo");

    // Se o login abrir em outra URL (SSO etc.), faça:
    // await page.waitForURL("https://ALGUMA-URL-DE-LOGIN/*");

    // 3) PREENCHER CPF/LOGIN E SENHA
    // Trocar '#campoLogin' e '#campoSenha' pelos seletores verdadeiros
    await page.fill("#campoLogin", LATTES_USERNAME);
    await page.fill("#campoSenha", CPF);

    await Promise.all([
      page.click("#botaoEntrar"), // trocar seletor também
      page.waitForLoadState("networkidle"),
    ]);

    // 4) IR PARA A ÁREA DE ARTIGOS
    // De novo: você precisa ajustar para o fluxo real de menus/links.
    // Pode ser um click em menu, ou ir direto pra uma URL interna.
    //
    // Exemplo genérico:
    // await page.click("text=Produção Bibliográfica");
    // await page.click("text=Artigos publicados");
    // await page.waitForLoadState("networkidle");

    // 5) PARA CADA ARTIGO DO JSON, CADASTRAR
    for (const art of articles) {
      // Isso aqui é SÓ UM MOLDE. Troque IDs/classes pelos nomes reais.
      //
      // Exemplo: clicar em "Novo artigo"
      // await page.click("text=Novo artigo");
      // await page.waitForSelector("#campoTituloArtigo");

      // título
      // await page.fill("#campoTituloArtigo", art.title || "");

      // se você já tiver esses campos no JSON, pode incluir:
      // await page.fill("#campoAno", String(art.year || ""));
      // await page.fill("#campoRevista", art.journal || "");

      // salvar
      // await Promise.all([
      //   page.click("text=Salvar"),
      //   page.waitForLoadState("networkidle"),
      // ]);

      // Por enquanto, só pra ver algo acontecendo, vamos logar no console:
      console.log("Simulando cadastro de artigo:", art.title);
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

// -------- endpoint que o n8n vai chamar --------
app.post("/lattes/atualizar", async (req, res) => {
  try {
    const payload = req.body;

    // O n8n SEMPRE envia um array
    if (!Array.isArray(payload)) {
      return res.status(400).json({
        error: "O corpo da requisição deve ser um array de objetos SerpAPI."
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
        description: c.description
      };
    });

    if (articles.length === 0) {
      return res.status(400).json({
        error: "Nenhum artigo encontrado no payload."
      });
    }

    // Aqui chamamos o Playwright para inserir os artigos no Lattes
    // await atualizarLattes(articles);
    return res.status(200).json({
      status: "ok",
      processed: articles.length
    });
  } catch (err) {
    console.error("Erro ao atualizar Lattes:", err);
    return res.status(500).json({
      status: "error",
      message: "Falha ao atualizar Lattes"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on :${PORT}`));
