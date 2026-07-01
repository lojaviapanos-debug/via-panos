require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Upload dir
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/viapanos')
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.log('Erro MongoDB:', err));

// Schemas
const ProdutoSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  descricao: String,
  preco: { type: Number, required: true },
  categoria: { type: String, enum: ['cama', 'mesa', 'banho'], required: true },
  imagem: String,
  estoque: { type: Number, default: 0 },
  ativo: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const ClienteSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  email: String,
  telefone: String,
  cpf: String,
  endereco: {
    rua: String, numero: String, complemento: String,
    bairro: String, cidade: String, estado: String, cep: String
  },
  createdAt: { type: Date, default: Date.now }
});

const PedidoSchema = new mongoose.Schema({
  numero: { type: String, unique: true },
  cliente: { nome: String, email: String, telefone: String, cpf: String, endereco: Object },
  itens: [{ produto: String, produtoId: String, quantidade: Number, preco: Number }],
  total: Number,
  status: { type: String, enum: ['pendente','confirmado','enviado','entregue','cancelado'], default: 'pendente' },
  olistId: String,
  olistStatus: String,
  observacoes: String,
  createdAt: { type: Date, default: Date.now }
});

const Produto = mongoose.model('Produto', ProdutoSchema);
const Cliente = mongoose.model('Cliente', ClienteSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);

// Olist OAuth
const OLIST_API = 'https://api.olist.com';
let accessToken = null;
let tokenExpiry = null;

async function getToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) return accessToken;
  try {
    const resp = await axios.post(`${OLIST_API}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: process.env.OLIST_CLIENT_ID,
      client_secret: process.env.OLIST_CLIENT_SECRET,
    });
    accessToken = resp.data.access_token;
    tokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
    return accessToken;
  } catch (e) {
    console.log('Erro token Olist:', e.message);
    return null;
  }
}

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token necessario' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'viapanos_secret_2024');
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ erro: 'Token invalido' });
  }
}

// ===== AUTH =====
app.post('/api/admin/login', async (req, res) => {
  try {
    const { senha } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'ViaPanos@2024!';
    
    // Comparacao direta (senha em texto puro na env var)
    const valid = (senha === adminPassword);
    
    if (!valid) return res.status(401).json({ erro: 'Senha incorreta' });
    
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET || 'viapanos_secret_2024', { expiresIn: '24h' });
    res.json({ token, mensagem: 'Login realizado com sucesso' });
  } catch(e) {
    res.status(500).json({ erro: e.message });
  }
});

// ===== PRODUTOS =====
app.get('/api/produtos', async (req, res) => {
  try {
    const filtro = { ativo: true };
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    const produtos = await Produto.find(filtro).sort({ createdAt: -1 });
    res.json(produtos);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/admin/produtos', authMiddleware, async (req, res) => {
  try {
    const produtos = await Produto.find().sort({ createdAt: -1 });
    res.json(produtos);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/admin/produtos', authMiddleware, upload.single('imagem'), async (req, res) => {
  try {
    const dados = { ...req.body, preco: parseFloat(req.body.preco), estoque: parseInt(req.body.estoque) || 0 };
    if (req.file) dados.imagem = '/uploads/' + req.file.filename;
    const produto = new Produto(dados);
    await produto.save();
    res.json(produto);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/admin/produtos/:id', authMiddleware, upload.single('imagem'), async (req, res) => {
  try {
    const dados = { ...req.body, preco: parseFloat(req.body.preco), estoque: parseInt(req.body.estoque) || 0 };
    if (req.file) dados.imagem = '/uploads/' + req.file.filename;
    const produto = await Produto.findByIdAndUpdate(req.params.id, dados, { new: true });
    res.json(produto);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/admin/produtos/:id', authMiddleware, async (req, res) => {
  try {
    await Produto.findByIdAndUpdate(req.params.id, { ativo: false });
    res.json({ mensagem: 'Produto removido' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== CLIENTES =====
app.get('/api/admin/clientes', authMiddleware, async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ createdAt: -1 });
    res.json(clientes);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/admin/clientes', authMiddleware, async (req, res) => {
  try {
    const cliente = new Cliente(req.body);
    await cliente.save();
    res.json(cliente);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/admin/clientes/:id', authMiddleware, async (req, res) => {
  try {
    const cliente = await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cliente);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/admin/clientes/:id', authMiddleware, async (req, res) => {
  try {
    await Cliente.findByIdAndDelete(req.params.id);
    res.json({ mensagem: 'Cliente removido' });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ===== PEDIDOS =====
app.get('/api/admin/pedidos', authMiddleware, async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ createdAt: -1 });
    res.json(pedidos);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/pedido', async (req, res) => {
  try {
    const { cliente, itens, observacoes } = req.body;
    const total = itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
    const numero = 'VP' + Date.now();

    // Salvar ou atualizar cliente
    if (cliente.email) {
      let clienteSalvo = await Cliente.findOne({ email: cliente.email });
      if (!clienteSalvo) {
        clienteSalvo = new Cliente(cliente);
        await clienteSalvo.save();
      }
    }

    // Criar pedido no banco
    const pedido = new Pedido({ numero, cliente, itens, total, observacoes });
    await pedido.save();

    // Enviar para Olist como proposta comercial
    try {
      const token = await getToken();
      if (token) {
        const olistPayload = {
          contact: {
            name: cliente.nome,
            email: cliente.email || '',
            phones: [{ type: 'mobile', number: (cliente.telefone || '').replace(/\D/g,'') }]
          },
          items: itens.map(item => ({
            name: item.produto,
            quantity: item.quantidade,
            price: item.preco
          })),
          total_amount: total,
          notes: observacoes || ('Pedido Via Panos #' + numero),
          status: 'pending'
        };

        const olistRes = await axios.post(`${OLIST_API}/v1/quotes`, olistPayload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        }).catch(async () => {
          return await axios.post(`${OLIST_API}/v1/contacts`, olistPayload.contact, {
            headers: { Authorization: `Bearer ${token}` }
          });
        });

        pedido.olistId = olistRes.data?.id || olistRes.data?.data?.id || 'enviado';
        pedido.olistStatus = 'enviado';
        await pedido.save();
      }
    } catch (olistErr) {
      console.log('Aviso Olist:', olistErr.message);
    }

    res.json({ sucesso: true, numeroPedido: numero, total, pedidoId: pedido._id });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

app.put('/api/admin/pedidos/:id/status', authMiddleware, async (req, res) => {
  try {
    const pedido = await Pedido.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(pedido);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Dashboard stats
app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const [totalPedidos, totalClientes, totalProdutos, pedidos] = await Promise.all([
      Pedido.countDocuments(),
      Cliente.countDocuments(),
      Produto.countDocuments({ ativo: true }),
      Pedido.find().select('total status')
    ]);
    const faturamento = pedidos.filter(p => p.status !== 'cancelado').reduce((acc, p) => acc + (p.total || 0), 0);
    const pedidosPendentes = pedidos.filter(p => p.status === 'pendente').length;
    res.json({ totalPedidos, totalClientes, totalProdutos, faturamento, pedidosPendentes });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Serve admin e index
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Via Panos rodando na porta ${PORT}`));
