const mercadopago = require("mercadopago");
const applyCors = require("../../utils/cors");
const { updateOrderStatus } = require("../../utils/orders");

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN
});

module.exports = async (req, res) => {
  applyCors(req, res, ["POST", "GET", "OPTIONS"]);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    console.error("Webhook chamado sem MP_ACCESS_TOKEN configurado");
    return res.status(500).send("MP_ACCESS_TOKEN não configurado");
  }

  try {
    let paymentId = null;

    // Formato mais novo (POST, body com data/type)
    if (req.method === "POST" && req.body) {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      if (body.type === "payment" && body.data && body.data.id) {
        paymentId = body.data.id;
      }
    }

    // Formato antigo (GET com query topic=payment&id=123)
    if (!paymentId && req.query) {
      const { topic, type, id } = req.query;
      if ((topic === "payment" || type === "payment") && id) {
        paymentId = id;
      }
    }

    if (!paymentId) {
      console.log("Webhook MP sem paymentId identificado", {
        body: req.body,
        query: req.query
      });
      // Mesmo sem paymentId, devolvemos 200 para não ficar re-tentando infinito
      return res.status(200).send("ok");
    }

    const result = await mercadopago.payment.findById(paymentId);
    const payment = result.body || {};

    const status = payment.status; // ex: "approved", "rejected", "pending"

    // tenta primeiro metadata.orderId; se não tiver, usa external_reference
    const metaOrderId =
      payment.metadata &&
      (payment.metadata.orderId || payment.metadata.order_id);
    const orderId = metaOrderId || payment.external_reference || null;

    const method = payment.payment_type_id; // ex: "credit_card", "pix"
    const value = payment.transaction_amount;

    console.log("Pagamento recebido no webhook:", {
      paymentId,
      status,
      orderId,
      method,
      value
    });

    if (orderId) {
      if (status === "approved") {
        await updateOrderStatus(orderId, "PAGO", {
          paymentId,
          provider: "MERCADO_PAGO",
          status,
          method,
          value
        });
      } else if (status === "rejected" || status === "cancelled") {
        await updateOrderStatus(orderId, "PAGAMENTO_FALHOU", {
          paymentId,
          provider: "MERCADO_PAGO",
          status,
          method,
          value
        });
      }
    } else {
      console.warn(
        "Webhook MP: pagamento sem orderId mapeado (metadata/external_reference vazios)",
        { paymentId }
      );
    }

    return res.status(200).send("Webhook processado");
  } catch (err) {
    console.error("Erro no webhook MP:", err);
    return res.status(500).send("Erro interno no webhook");
  }
};
