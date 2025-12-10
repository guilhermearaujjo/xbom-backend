// api/status.js

const applyCors = require("../utils/cors");
const { getOrder } = require("../utils/orders");

module.exports = async (req, res) => {
  // libera CORS para GET e OPTIONS
  applyCors(req, res, ["GET", "OPTIONS"]);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({
        ok: false,
        error: "Método não permitido"
      });
    }

    const { orderId } = req.query || {};

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: "Parâmetro orderId obrigatório"
      });
    }

    // usa o mesmo helper do /api/orders
    const order = await getOrder(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Pedido não encontrado"
      });
    }

    // normaliza status para checar se já está pago
    const rawStatus = String(order.status || "").toUpperCase();
    const rawPaymentType = String(order.paymentType || "").toUpperCase();

    // aqui você pode afinar depois, mas a lógica base é:
    // - status contendo "PAGO (MP)" ou "PAGO"
    // - ou paymentType indicando algo de pagamento online aprovado
    const isPaid =
      rawStatus.includes("PAGO (MP)") ||
      rawStatus.includes("PAGO") ||
      rawStatus.includes("APPROVED") ||
      rawPaymentType.includes("ONLINE_MP") ||
      rawPaymentType.includes("ONLINE");

    return res.status(200).json({
      ok: true,
      orderId,
      isPaid,
      status: order.status || null,
      paymentType: order.paymentType || null,
      order
    });

  } catch (err) {
    console.error("Erro em /api/status:", err);
    return res.status(500).json({
      ok: false,
      error: "Erro interno em /api/status",
      details: err.message || String(err)
    });
  }
};
