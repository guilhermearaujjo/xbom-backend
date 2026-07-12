const mercadopago = require("mercadopago");
const applyCors = require("../../utils/cors");
const { updateOrderStatus } = require("../../utils/orders");
const { db, admin } = require("../../utils/firebase");
const { enviarParaFila } = require("../fila");

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
        // ===== PROTEÇÃO CONTRA IMPRESSÃO DUPLICADA =====
        // O Mercado Pago pode (e frequentemente) envia a mesma notificação de
        // pagamento mais de uma vez. Um simples "checa status, depois atualiza"
        // tem uma brecha de corrida: se duas notificações chegarem quase juntas,
        // as duas podem checar "ainda não pago" antes de qualquer uma terminar
        // de atualizar, e as duas mandam pra fila (impressão duplicada).
        //
        // Uma transação do Firestore resolve isso de forma atômica: mesmo que
        // duas chamadas rodem ao mesmo tempo, o Firestore garante que só uma
        // delas vai "vencer" e ver o status como ainda não-pago.
        let shouldPrint = false;
        let pedidoCompleto = null;

        try {
          await db.runTransaction(async (t) => {
            const ref = db.collection("orders").doc(orderId);
            const snap = await t.get(ref);
            if (!snap.exists) return;

            const data = snap.data();
            pedidoCompleto = { id: snap.id, ...data };

            const statusAtual = String(data.status || "").toUpperCase();
            if (statusAtual !== "PAGO") {
              shouldPrint = true;
              t.update(ref, {
                status: "PAGO",
                payment: {
                  paymentId,
                  provider: "MERCADO_PAGO",
                  status,
                  method,
                  value
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            }
          });
        } catch (err) {
          console.error("[webhook] erro na transação de status:", err);
        }

        if (shouldPrint && pedidoCompleto) {
          try {
            await enviarParaFila(pedidoCompleto);
          } catch (err) {
            // falha ao enviar para a fila nunca deve derrubar o webhook
            console.error("[webhook][fila] erro ao enviar para fila:", err);
          }
        } else if (!shouldPrint) {
          console.log(
            "[webhook] pedido já estava marcado como PAGO, pulando fila (notificação duplicada):",
            orderId
          );
        } else {
          console.warn(
            "[webhook][fila] pedido aprovado mas não encontrado no Firestore:",
            orderId
          );
        }
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
