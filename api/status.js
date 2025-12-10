// api/status.js

// ⚠️ IMPORTANTE:
// COPIE EXATAMENTE a mesma importação usada no /api/orders.js.
// Exemplo (APENAS EXEMPLO — substitua pelo seu):
// const admin = require("../utils/firebaseAdmin");

const db = admin.firestore();

module.exports = async (req, res) => {
  try {
    // Apenas GET é permitido
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({
        ok: false,
        error: "Método não permitido"
      });
    }

    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: "Parâmetro orderId obrigatório"
      });
    }

    // Busca no Firestore
    const snap = await db.collection("orders").doc(orderId).get();

    if (!snap.exists) {
      return res.status(404).json({
        ok: false,
        error: "Pedido não encontrado"
      });
    }

    const order = snap.data();

    // Normaliza qualquer tipo de status que possa representar "pago"
    const statusRaw = String(order.status || order.paymentStatus || "").toUpperCase();

    const isPaid =
      statusRaw.includes("PAGO (MP)") ||
      statusRaw.includes("PAGO") ||
      statusRaw.includes("PAID") ||
      statusRaw.includes("APPROVED");

    return res.json({
      ok: true,
      orderId,
      isPaid,
      status: order.status || order.paymentStatus || null
    });

  } catch (err) {
    console.error("[/api/status] erro:", err);

    return res.status(500).json({
      ok: false,
      error: "Erro interno ao consultar status do pedido"
    });
  }
};
