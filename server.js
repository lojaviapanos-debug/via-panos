require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/viapanos')
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.log('Erro MongoDB:', err));

const ProdutoSchema = new mongoose.Schema({
  sku: { type: String, default: '' },
  nome: String,
  descricao: String,
  preco: Number,
  categoria: String,
  estoque: { type: Number, default: 0 },
  imagens: [String],
  ativo: { type: Boolean, default: true },
  criadoEm: { type: Date, default: Date.now }
});

const ClienteSchema = new mongoose.Schema({
  nome: String, email: String, telefone: String, endereco: String,
  criadoEm: { type: Date, default: Date.now }
});

const PedidoSchema = new mongoose.Schema({
  clienteId: String, clienteNome: String,
  itens: [{ produtoId: String, produtoNome: String, quantidade: Number, preco: Number }],
  total: Number, status: { type: String, default: 'pendente' },
  olistPropostaId: String, criadoEm: { type: Date, default: Date.now }
});

const Produto = mongoose.model('Produto', ProdutoSchema);
const Cliente = mongoose.model('Cliente', ClienteSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'viapanos-secret-2024';
const adminPassword = process.env.ADMIN_PASSWORD || 'ViaPanos@2024!';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token necessario' });
  try { jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ erro: 'Token invalido' }); }
}

app.post('/api/login', (req, res) => {
  const { senha } = req.body;
  if (senha === adminPassword) {
    res.json({ token: jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' }) });
  } else {
    res.status(401).json({ erro: 'Senha incorreta' });
  }
});

app.post('/api/upload', authMiddleware, upload.array('imagens', 10), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ erro: 'Nenhum arquivo' });
  res.json({ urls: req.files.map(f => '/uploads/' + f.filename) });
});

app.get('/api/produtos', async (req, res) => {
  try { res.json(await Produto.find({ ativo: true })); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/produtos/todos', authMiddleware, async (req, res) => {
  try { res.json(await Produto.find()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/produtos', authMiddleware, async (req, res) => {
  try { res.json(await new Produto(req.body).save()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/produtos/:id', authMiddleware, async (req, res) => {
  try { res.json(await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/produtos/:id', authMiddleware, async (req, res) => {
  try { await Produto.findByIdAndDelete(req.params.id); res.json({ sucesso: true }); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/clientes', authMiddleware, async (req, res) => {
  try { res.json(await Cliente.find()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/clientes', authMiddleware, async (req, res) => {
  try { res.json(await new Cliente(req.body).save()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/clientes/:id', authMiddleware, async (req, res) => {
  try { res.json(await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.delete('/api/clientes/:id', authMiddleware, async (req, res) => {
  try { await Cliente.findByIdAndDelete(req.params.id); res.json({ sucesso: true }); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.get('/api/pedidos', authMiddleware, async (req, res) => {
  try { res.json(await Pedido.find().sort({ criadoEm: -1 })); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/pedidos', authMiddleware, async (req, res) => {
  try { res.json(await new Pedido(req.body).save()); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.put('/api/pedidos/:id', authMiddleware, async (req, res) => {
  try { res.json(await Pedido.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch(err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/olist/proposta', authMiddleware, async (req, res) => {
  const { pedidoId } = req.body;
  const clientId = process.env.OLIST_CLIENT_ID;
  const clientSecret = process.env.OLIST_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(400).json({ erro: 'Credenciais Olist nao configuradas' });
  try {
    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Pedido nao encontrado' });
    const tokenResp = await axios.post('https://api.olist.com/oauth/token', {
      grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret
    });
    const proposta = {
      customer_name: pedido.clienteNome,
      items: pedido.itens.map(i => ({ product_code: i.produtoId, product_name: i.produtoNome, quantity: i.quantidade, unit_price: i.preco }))
    };
    const propostaResp = await axios.post('https://api.olist.com/comercial/proposals', proposta,
      { headers: { Authorization: 'Bearer ' + tokenResp.data.access_token } });
    await Pedido.findByIdAndUpdate(pedidoId, { olistPropostaId: propostaResp.data.id, status: 'enviado_olist' });
    res.json({ sucesso: true, olistId: propostaResp.data.id });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
