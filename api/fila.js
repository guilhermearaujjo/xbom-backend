// api/fila.js
// Chamado internamente pelo /api/pedidos após salvar no Firebase
// Repassa o pedido para a fila PHP na Hostinger

const HOSTINGER_FILA_URL = 'https://olivedrab-turkey-827723.hostingersite.com/fila.php';
const FILA_TOKEN = process.env.FILA_TOKEN || 'xbom-backend';

async function enviarParaFila(orderData) {
  try {
    const resp = await fetch(HOSTINGER_FILA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Fila-Token': FILA_TOKEN
      },
      body: JSON.stringify(orderData)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('[fila] erro ao enviar para fila PHP:', resp.status, txt);
      return false;
    }

    const data = await resp.json();
    console.log('[fila] pedido salvo na fila:', data);
    return true;
  } catch (err) {
    console.error('[fila] erro de rede ao enviar para fila PHP:', err.message);
    return false;
  }
}

module.exports = { enviarParaFila };
