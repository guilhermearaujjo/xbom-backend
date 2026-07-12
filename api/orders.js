const applyCors = require("../utils/cors");
const { createOrder, listOrders, getOrder } = require("../utils/orders");
const { enviarParaFila } = require("./fila");
module.exports = async (req, res) => {
  applyCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  try {
    if (req.method === "GET") {
      const { id } = req.query || {};
      if (id) {
        const order = await getOrder(id);
        if (!order) {
          return res.status(404).json({ error: "Pedido não encontrado" });
        }
        return res.status(200).json({ ok: true, order });
      } else {
        const orders = await listOrders();
        return res.status(200).json({ ok: true, orders });
      }
    }
    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const {
        orderId,
        customer,
        items,
        total,
        subtotal,
        taxa,
        deliveryType,
        paymentType,
        paymentOnDeliveryMethod,
        obs,
        origem
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
      const orderData = {
        orderId,
        customer,
        items,
        total: Number(total),
        subtotal: Number(subtotal || 0),
        taxa: Number(taxa || 0),
        deliveryType: deliveryType || "RETIRADA",
        paymentType: paymentType || "PAGAR_DEPOIS",
        paymentOnDeliveryMethod: paymentOnDeliveryMethod || "dinheiro",
        obs: obs || "",
        origem: origem || "site",
        status: "AGUARDANDO_PREPARO",
        source: "SITE_XBOM"
      };
      const saved = await createOrder(orderData);
      // envia para fila PHP da Hostinger (impressora em segundo plano)
      // await garante que a chamada termine antes do Vercel finalizar a função
      // try/catch garante que falha na fila nunca derruba o pedido
      try {
        await enviarParaFila(saved);
      } catch (err) {
        console.error('[fila] erro:', err);
      }
      return res.status(201).json({ ok: true, order: saved });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Erro em /api/orders:", err);
    return res.status(500).json({
      error: "Erro interno em /api/orders",
      details: err.message || String(err)
    });
  }
};
