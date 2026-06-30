require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const OLIST_API = 'https://api.olist.com';
let accessToken = null;
let tokenExpiry = null;

async function getToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }
  const response = await axios.post(`${OLIST_API}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: process.env.OLIST_CLIENT_ID,
    client_secret: process.env.OLIST_CLIENT_SECRET,
  });
  accessToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return accessToken;
}

app.post('/pedido', async (req, res) => {
  try {
    const { cliente, itens, pagamento, frete } = req.body;
    const token = await getToken();
    const payload = {
      customer: {
        name: cliente.nome,
        email: cliente.email,
        phone: cliente.telefone,
        address: {
          street: cliente.rua,
          number: cliente.numero,
          complement: cliente.complemento,
          neighborhood: cliente.bairro,
          city: cliente.cidade,
          state: cliente.estado,
          zip_code: cliente.cep,
        }
      },
      items: itens.map(item => ({
        product_id: item.id,
        quantity: item.quantidade,
        unit_price: item.preco,
      })),
      payment_method: pagamento,
      shipping_cost: frete,
    };
    const olistResponse = await axios.post(
      `${OLIST_API}/v3/orders`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ sucesso: true, pedido_id: olistResponse.data.id });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ sucesso: false, erro: 'Erro ao criar pedido no Olist.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Via Panos rodando na porta ${PORT}`));
