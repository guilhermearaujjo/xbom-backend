// api/mp/create-preference.js

const applyCors = require("../../utils/cors");
const mercadopago = require("mercadopago");
const { createOrder } = require("../../utils/orders");

const { MP_ACCESS_TOKEN, BACKEND_BASE_URL } = process.env;

mercadopago.configure({
  access_token: MP_ACCESS_TOKEN || ""
});

module.exports = async (req, res) => {
  // === CORS SEMPRE PRIMEIRO ===
  applyCors(req, res);

  // Preflight (OPTIONS) – navegador checa CORS aqui
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
      successUrl,
      failureUrl,
      pendingUrl
    } = req.body || {};

    // ===== VALIDAÇÕES BÁSICAS =====
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

    // ===== NORMALIZA TELEFONE (MP exige number) =====
    const rawPhone = customer.phone || customer.telefone || "";
    const phoneDigits = String(rawPhone).replace(/\D/g, "");
    const phoneNumber = phoneDigits ? Number(phoneDigits) : null;

    // monta itens para o Mercado Pago
    const mpItems = items.map((it) => ({
      id: it.id,
      title: it.name,
      quantity: Number(it.quantity || 1),
      currency_id: "BRL",
      unit_price: Number(it.unit_price || 0)
    }));

    const notificationUrl = BACKEND_BASE_URL
      ? `${BACKEND_BASE_URL.replace(/\/$/, "")}/api/mp/webhook`
      : undefined;

    const payer = {
      name: customer.name || "",
      address: {
        street_name: customer.address || "",
        zip_code: customer.cep || ""
      }
    };

    // só envia phone se tiver número válido
    if (phoneNumber && !Number.isNaN(phoneNumber)) {
      payer.phone = {
        number: phoneNumber
      };
    }

    const preference = {
      items: mpItems,
      external_reference: orderId,
      metadata: { orderId }, // 👈 AGORA O WEBHOOK CONSEGUE LER
      back_urls: {
        success: successUrl || "",
        failure: failureUrl || "",
        pending: pendingUrl || ""
      },
      auto_return: "approved",
      payer
    };

    if (notificationUrl) {
      preference.notification_url = notificationUrl;
    }

    const prefResult = await mercadopago.preferences.create(preference);
    const prefBody = prefResult && prefResult.body ? prefResult.body : {};

    const initPoint = prefBody.init_point;
    const preferenceId = prefBody.id;

    if (!initPoint) {
      console.error("[mp][create-preference] resposta sem init_point:", prefBody);
      return res.status(500).json({
        error: "Não foi possível obter o link de pagamento do Mercado Pago"
      });
    }

    // registra pedido no Firestore com status pendente de pagamento
    await createOrder({
      orderId,
      customer,
      items,
      total: totalNumber,
      deliveryType: deliveryTypeSafe,
      paymentType: "PAGAR_AGORA_MP",
      status: "PENDENTE_PAGAMENTO",
      origem: "site",
      mp: {
        preferenceId,
        init_point: initPoint
      }
    });

    return res.status(200).json({
      ok: true,
      orderId,
      init_point: initPoint,
      preference_id: preferenceId
    });
  } catch (err) {
    console.error("[mp][create-preference] erro:", err);
    return res.status(500).json({
      error: "Erro ao criar preferência de pagamento",
      detail: err.message || String(err)
    });
  }
};
