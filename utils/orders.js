const { admin, db } = require("./firebase");

async function createOrder(orderData) {
  if (!db) {
    throw new Error("Firestore não inicializado. Verifique as variáveis de ambiente do Firebase.");
  }
  const collection = db.collection("orders");
  const ref = orderData.orderId ? collection.doc(orderData.orderId) : collection.doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    ...orderData,
    orderId: ref.id,
    status: orderData.status || "AGUARDANDO_PAGAMENTO",
    createdAt: orderData.createdAt || now,
    updatedAt: now
  };
  await ref.set(payload, { merge: true });
  return payload;
}

async function updateOrderStatus(orderId, status, paymentInfo) {
  if (!db) {
    throw new Error("Firestore não inicializado. Verifique as variáveis de ambiente do Firebase.");
  }
  if (!orderId) return;
  const ref = db.collection("orders").doc(orderId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const update = {
    status,
    updatedAt: now
  };
  if (paymentInfo) {
    update.payment = paymentInfo;
  }
  await ref.set(update, { merge: true });
}

async function getOrder(orderId) {
  if (!db) {
    throw new Error("Firestore não inicializado. Verifique as variáveis de ambiente do Firebase.");
  }
  const ref = db.collection("orders").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data();
}

async function listOrders(limit = 50) {
  if (!db) {
    throw new Error("Firestore não inicializado. Verifique as variáveis de ambiente do Firebase.");
  }
  const snap = await db
    .collection("orders")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data());
}

// =========================
// DIRETÓRIO DE CLIENTES (painel)
// =========================
// Chamado sempre que um pedido é CONFIRMADO (dinheiro: na criação;
// Mercado Pago: no momento em que o webhook confirma o pagamento).
// Usa o telefone (só dígitos) como identificador do cliente, então
// pedidos repetidos do mesmo telefone acumulam no mesmo registro.
async function upsertCustomer(orderData) {
  if (!db) return;

  const customer = orderData.customer || {};
  const phoneRaw = customer.phone || customer.telefone || "";
  const phoneDigits = String(phoneRaw).replace(/\D/g, "");
  if (!phoneDigits) return; // sem telefone não dá pra identificar o cliente

  const ref = db.collection("customers").doc(phoneDigits);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const total = Number(orderData.total || 0);

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);

      if (!snap.exists) {
        t.set(ref, {
          name: customer.name || "",
          phone: phoneRaw,
          address: customer.address || "",
          cep: customer.cep || "",
          first_order_at: now,
          last_order_at: now,
          total_orders: 1,
          total_spent: total
        });
      } else {
        const data = snap.data() || {};
        t.update(ref, {
          name: customer.name || data.name || "",
          phone: phoneRaw || data.phone || "",
          address: customer.address || data.address || "",
          cep: customer.cep || data.cep || "",
          last_order_at: now,
          total_orders: (Number(data.total_orders) || 0) + 1,
          total_spent: (Number(data.total_spent) || 0) + total
        });
      }
    });
  } catch (err) {
    // atualizar o diretório de clientes nunca deve derrubar o fluxo do pedido
    console.error("[upsertCustomer] erro:", err);
  }
}

module.exports = {
  createOrder,
  updateOrderStatus,
  getOrder,
  listOrders,
  upsertCustomer
};
