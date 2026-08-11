// api/mp/create-pix.js
//
// Pix transparente: cria o pagamento direto na API do Mercado Pago e devolve
// o QR code + copia-e-cola para o site exibir num overlay, sem redirect.
//
// O webhook atual (api/mp/webhook.js) NÃO precisa de nenhuma alteração:
// ele resolve o pedido por metadata.orderId ou external_reference, e os dois
// são enviados aqui. Quando o Pix é aprovado, o próprio webhook marca PAGO,
// manda para a fila de impressão e atualiza o cliente — igual ao cartão.

const applyCors = require("../../utils/cors");
const mercadopago = require("mercadopago");
const { createOrder } = require("../../utils/orders");

const { MP_ACCESS_TOKEN, BACKEND_BASE_URL, PIX_EMAIL_GENERICO } = process.env;

mercadopago.configure({
  access_token: MP_ACCESS_TOKEN || ""
});

// Usado quando a pessoa não está logada no site.
// ⚠️ NÃO pode ser o e-mail da própria conta Mercado Pago do X-Bom —
// o MP recusa pagamento em que pagador e recebedor são a mesma conta.
const EMAIL_GENERICO = PIX_EMAIL_GENERICO || "pedidos@xbom.com.br";

// Tempo que o QR code fica válido
const EXPIRACAO_MINUTOS = 15;

function emailValido(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Monta a data de expiração no formato que o MP exige,
// com offset de fuso (ex.: 2026-08-11T20:45:00.000-03:00)
function dataExpiracao(minutos) {
  const d = new Date(Date.now() + minutos * 60 * 1000);

  const pad = (n, tam = 2) => String(Math.abs(n)).padStart(tam, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? "+" : "-";
  const offset = `${sinal}${pad(offsetMin / 60 | 0)}:${pad(offsetMin % 60)}`;

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${offset}`
  );
}

function separarNome(nomeCompleto) {
  const partes = String(nomeCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return { first_name: "Cliente", last_name: "X-Bom" };
  if (partes.length === 1) return { first_name: partes[0], last_name: "X-Bom" };
  return {
    first_name: partes[0],
    last_name: partes.slice(1).join(" ")
  };
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MP_ACCESS_TOKEN não configurado no backend"
      });
    }

    const {
      orderId,
      customer,
      items,
      total,
      deliveryType,
      subtotal,
      taxa,
      client_uid,
      payerEmail,
      obs
    } = req.body || {};

    // ===== VALIDAÇÕES BÁSICAS (mesmas do create-preference) =====
    if (!orderId) {
      return res.status(400).json({ error: "orderId é obrigatório" });
    }
    if (!customer || !customer.name) {
      return res.status(400).json({ error: "Dados do cliente inválidos" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Itens do pedido inválidos" });
    }
    const totalNumber = Number(total || 0);
    if (!totalNumber || totalNumber <= 0) {
      return res.status(400).json({ error: "Total do pedido inválido" });
    }

    const deliveryTypeSafe =
      deliveryType === "ENTREGA" || deliveryType === "RETIRADA"
        ? deliveryType
        : "RETIRADA";

    // E-mail do pagador: o da conta logada quando existir, senão o genérico.
    const email = emailValido(payerEmail) ? payerEmail.trim() : EMAIL_GENERICO;

    // ===== 1) REGISTRA O PEDIDO ANTES DE GERAR O PIX =====
    // Assim, se o pagamento for aprovado muito rápido, o webhook já encontra
    // o documento em "orders" para marcar PAGO e mandar para a impressão.
    await createOrder({
      orderId,
      customer,
      items,
      total: totalNumber,
      subtotal: Number(subtotal || 0),
      taxa: Number(taxa || 0),
      deliveryType: deliveryTypeSafe,
      paymentType: "PAGAR_AGORA_PIX",
      status: "PENDENTE_PAGAMENTO",
      origem: "site",
      obs: obs || "",
      client_uid: client_uid || null
    });

    // ===== 2) CRIA O PAGAMENTO PIX =====
    const notificationUrl = BACKEND_BASE_URL
      ? `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/mp/webhook`
      : undefined;

    const { first_name, last_name } = separarNome(customer.name);
    const expiraEm = dataExpiracao(EXPIRACAO_MINUTOS);

    const pagamento = {
      transaction_amount: Number(totalNumber.toFixed(2)),
      description: `Pedido ${orderId} - X-Bom Lanches`,
      payment_method_id: "pix",
      // Os dois campos abaixo são o que permite o webhook achar o pedido.
      // Sem eles, o pagamento cairia no fluxo de "Pix avulso" e imprimiria
      // um recibo solto em vez do pedido da cozinha.
      external_reference: orderId,
      metadata: { orderId },
      date_of_expiration: expiraEm,
      payer: {
        email,
        first_name,
        last_name
      }
    };

    if (notificationUrl) {
      pagamento.notification_url = notificationUrl;
    }

    const result = await mercadopago.payment.create(pagamento);
    const body = (result && result.body) ? result.body : {};

    const dadosPix =
      body.point_of_interaction &&
      body.point_of_interaction.transaction_data
        ? body.point_of_interaction.transaction_data
        : null;

    if (!dadosPix || !dadosPix.qr_code) {
      console.error("[mp][create-pix] resposta sem QR code:", body);
      return res.status(500).json({
        error: "Não foi possível gerar o Pix no Mercado Pago"
      });
    }

    return res.status(200).json({
      ok: true,
      orderId,
      paymentId: body.id,
      status: body.status,
      qr_code: dadosPix.qr_code,               // copia-e-cola
      qr_code_base64: dadosPix.qr_code_base64, // imagem do QR (PNG em base64)
      ticket_url: dadosPix.ticket_url || null,
      expira_em: body.date_of_expiration || expiraEm
    });

  } catch (err) {
    console.error("[mp][create-pix] erro:", err);
    return res.status(500).json({
      error: "Erro ao gerar pagamento Pix",
      detail: err.message || String(err)
    });
  }
};
