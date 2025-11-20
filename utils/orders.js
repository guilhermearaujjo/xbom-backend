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

module.exports = {
  createOrder,
  updateOrderStatus,
  getOrder,
  listOrders
};
