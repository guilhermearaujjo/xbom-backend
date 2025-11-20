const applyCors = require("../utils/cors");
const { createOrder, listOrders, getOrder } = require("../utils/orders");

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
        deliveryType,
        paymentType
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
        deliveryType: deliveryType || "RETIRADA",
        paymentType: paymentType || "PAGAR_DEPOIS", // retirada/entrega pagando no balcão
        status: "AGUARDANDO_PREPARO",
        source: "SITE_XBOM"
      };

      const saved = await createOrder(orderData);

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
