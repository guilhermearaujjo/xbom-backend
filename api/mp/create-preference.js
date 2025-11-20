const mercadopago = require("mercadopago");
const applyCors = require("../../utils/cors");
const { createOrder } = require("../../utils/orders");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
  applyCors(req, res, ["POST", "OPTIONS"]);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return res
      .status(500)
      .json({ error: "MP_ACCESS_TOKEN não configurado no backend" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const {
      orderId,
      customer,
      items,
      total,
      deliveryType,
      successUrl,
      failureUrl,
      pendingUrl
    } = body;

    if (!items || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Itens do pedido são obrigatórios" });
    }

    if (!customer || !customer.name || !customer.phone) {
      return res.status(400).json({
        error: "Dados do cliente são obrigatórios (customer.name, customer.phone)"
      });
    }

    if (!total) {
      return res.status(400).json({ error: "Total é obrigatório" });
    }

    if (!successUrl || !failureUrl) {
      return res
        .status(400)
        .json({ error: "successUrl e failureUrl são obrigatórios" });
    }

    const totalNumber = Number(total);
    if (Number.isNaN(totalNumber) || totalNumber <= 0) {
      return res.status(400).json({ error: "Total inválido" });
    }

    const BACKEND_BASE_URL =
      process.env.BACKEND_BASE_URL || `https://${req.headers.host}`;

    // 1) Cria/garante pedido na esteira com status aguardando pagamento
    const paymentType = "MERCADO_PAGO";
    const orderData = {
      orderId,
      customer,
      items,
      total: totalNumber,
      deliveryType: deliveryType || "RETIRADA",
      paymentType,
      status: "AGUARDANDO_PAGAMENTO",
      source: "SITE_XBOM"
    };

    const savedOrder = await createOrder(orderData);
    const finalOrderId = savedOrder.orderId;

    const title = `Pedido X-Bom - ${customer.name}`;

    const preference = {
      items: [
        {
          id: finalOrderId,
          title,
          quantity: 1,
          unit_price: totalNumber
        }
      ],
      metadata: {
        orderId: finalOrderId
      },
      back_urls: {
        success: `${successUrl}?status=approved&orderId=${encodeURIComponent(
          finalOrderId
        )}`,
        failure: `${failureUrl}?status=failure&orderId=${encodeURIComponent(
          finalOrderId
        )}`,
        pending:
          pendingUrl ||
          `${successUrl}?status=pending&orderId=${encodeURIComponent(
            finalOrderId
          )}`
      },
      auto_return: "approved",
      notification_url: `${BACKEND_BASE_URL}/api/mp/webhook`
    };

    const result = await mercadopago.preferences.create(preference);

    return res.status(200).json({
      ok: true,
      orderId: finalOrderId,
      preferenceId: result.body.id,
      init_point: result.body.init_point,
      sandbox_init_point: result.body.sandbox_init_point
    });
  } catch (err) {
    console.error("Erro em /api/mp/create-preference:", err);
    return res.status(500).json({
      error: "Erro ao criar preferência de pagamento",
      details: err.message || String(err)
    });
  }
};
