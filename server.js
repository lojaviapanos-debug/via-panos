const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://lojaviapanos_db_user:0rDKMCYoxnG7ghhQ@cluster0.bngn9vw.mongodb.net/viapanos?appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'viapanos_secret_2024';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'ViaPanos@2024!';
const OLIST_CLIENT_ID = process.env.OLIST_CLIENT_ID || 'tiny-api-eda9d5290d8afccfbb75c0e795bb493cc52e8de1-1782856255';
const OLIST_CLIENT_SECRET = process.env.OLIST_CLIENT_SECRET || 'FnoEQSFpwZi2kUbb5hpmC6u7EqGyaLtW';

mongoose.connect(MONGO_URI).then(() => console.log('MongoDB conectado')).catch(e => console.error(e));

// Schemas
const ProdutoSchema = new mongoose.Schema({
  nome: String,
  descricao: { type: String, default: '' },
  preco: Number,
  categoria: String,
  imagem: String,
  imagens: { type: [String], default: [] },
  estoque: { type: Number, default: 0 },
  ativo: { type: Boolean, default: true },
  sku: { type: String, default: '' },
  criadoEm: { type: Date, default: Date.now }
}, { timestamps: true });
const Produto = mongoose.model('Produto', ProdutoSchema);

const CategoriaSchema = new mongoose.Schema({
  nome: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  ordem: { type: Number, default: 0 }
}, { timestamps: true });
const Categoria = mongoose.model('Categoria', CategoriaSchema);

const ClienteSchema = new mongoose.Schema({
  nome: String,
  email: String,
  telefone: String,
  endereco: String,
  criadoEm: { type: Date, default: Date.now }
}, { timestamps: true });
const Cliente = mongoose.model('Cliente', ClienteSchema);

const PedidoSchema = new mongoose.Schema({
  numeroPedido: { type: String, unique: true },
  cliente: {
    nome: String,
    email: String,
    telefone: String,
    endereco: String
  },
  itens: [{
    produtoId: String,
    nome: String,
    preco: Number,
    quantidade: Number,
    sku: String
  }],
  total: Number,
  status: { type: String, default: 'pendente', enum: ['pendente', 'confirmado', 'enviado', 'entregue', 'cancelado'] },
  olistEnviado: { type: Boolean, default: false },
  olistId: { type: String, default: '' },
  observacoes: { type: String, default: '' },
  criadoEm: { type: Date, default: Date.now }
}, { timestamps: true });
const Pedido = mongoose.model('Pedido', PedidoSchema);

// Upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => { cb(null, uuidv4() + path.extname(file.originalname)); }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token necessario' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ erro: 'Token invalido' });
  }
}

// Gerar numero de pedido
async function gerarNumeroPedido() {
  const count = await Pedido.countDocuments();
  return 'VP' + String(count + 1).padStart(5, '0');
}

// ============ AUTH ============
app.post('/api/login', async (req, res) => {
  const { senha } = req.body;
  if (senha !== ADMIN_SENHA) return res.status(401).json({ erro: 'Senha incorreta' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

// ============ PRODUTOS ============
app.get('/api/produtos', async (req, res) => {
  try {
    const prods = await Produto.find({ ativo: true }).sort({ criadoEm: -1 });
    res.json(prods);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/admin/produtos', authMiddleware, async (req, res) => {
  try {
    const prods = await Produto.find().sort({ criadoEm: -1 });
    res.json(prods);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/produtos', authMiddleware, upload.array('imagens', 10), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, estoque, ativo, sku } = req.body;
    var imagens = req.files ? req.files.map(f => '/uploads/' + f.filename) : [];
    var imagem = imagens.length > 0 ? imagens[0] : '';
    const prod = new Produto({ nome, descricao, preco: parseFloat(preco), categoria, estoque: parseInt(estoque) || 0, ativo: ativo !== 'false', sku: sku || '', imagem, imagens });
    await prod.save();
    res.json(prod);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/produtos/:id', authMiddleware, upload.array('imagens', 10), async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, estoque, ativo, sku } = req.body;
    var update = { nome, descricao, preco: parseFloat(preco), categoria, estoque: parseInt(estoque) || 0, ativo: ativo !== 'false', sku: sku || '' };
    if (req.files && req.files.length > 0) {
      var novas = req.files.map(f => '/uploads/' + f.filename);
      update.imagens = novas;
      update.imagem = novas[0];
    }
    const prod = await Produto.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(prod);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/produtos/:id', authMiddleware, async (req, res) => {
  try {
    await Produto.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============ CATEGORIAS ============
app.get('/api/categorias', async (req, res) => {
  try {
    const cats = await Categoria.find().sort({ ordem: 1, nome: 1 });
    res.json(cats);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/categorias', authMiddleware, async (req, res) => {
  try {
    const { nome, ordem } = req.body;
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatorio' });
    var slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var cat = new Categoria({ nome, slug, ordem: parseInt(ordem) || 0 });
    await cat.save();
    res.json(cat);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ erro: 'Categoria ja existe' });
    res.status(500).json({ erro: e.message });
  }
});

app.put('/api/categorias/:id', authMiddleware, async (req, res) => {
  try {
    const { nome, ordem } = req.body;
    var slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var cat = await Categoria.findByIdAndUpdate(req.params.id, { nome, slug, ordem: parseInt(ordem) || 0 }, { new: true });
    res.json(cat);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/categorias/:id', authMiddleware, async (req, res) => {
  try {
    await Categoria.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============ CLIENTES ============
app.get('/api/clientes', authMiddleware, async (req, res) => {
  try {
    const clientes = await Cliente.find().sort({ criadoEm: -1 });
    res.json(clientes);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============ PEDIDOS ============
// Rota publica - catalogo envia pedido sem autenticacao
app.post('/api/pedido-publico', async (req, res) => {
  try {
    const { cliente, itens, total, observacoes } = req.body;
    if (!cliente || !itens || !itens.length) return res.status(400).json({ erro: 'Dados incompletos' });
    // Salvar ou atualizar cliente
    var clienteSalvo = await Cliente.findOneAndUpdate(
      { telefone: cliente.telefone },
      { nome: cliente.nome, email: cliente.email || '', telefone: cliente.telefone, endereco: cliente.endereco || '' },
      { upsert: true, new: true }
    );
    var numeroPedido = await gerarNumeroPedido();
    var pedido = new Pedido({
      numeroPedido,
      cliente: { nome: cliente.nome, email: cliente.email || '', telefone: cliente.telefone, endereco: cliente.endereco || '' },
      itens: itens.map(i => ({ produtoId: i.id || i._id || '', nome: i.nome, preco: i.preco, quantidade: i.quantidade, sku: i.sku || '' })),
      total: parseFloat(total) || 0,
      observacoes: observacoes || ''
    });
    await pedido.save();
    res.json({ ok: true, numeroPedido, id: pedido._id });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/pedidos', authMiddleware, async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ criadoEm: -1 });
    res.json(pedidos);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/pedidos/:id', authMiddleware, async (req, res) => {
  try {
    const ped = await Pedido.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(ped);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/pedidos/:id', authMiddleware, async (req, res) => {
  try {
    await Pedido.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============ OLIST ENVIO ============
app.post('/api/enviar-olist/:pedidoId', authMiddleware, async (req, res) => {
  try {
    var pedido = await Pedido.findById(req.params.pedidoId);
    if (!pedido) return res.status(404).json({ erro: 'Pedido nao encontrado' });
    if (pedido.olistEnviado) return res.status(400).json({ erro: 'Pedido ja enviado ao Olist' });

    // Obter token Olist
    var tokenResp = await axios.post('https://accounts.olist.com/oauth2/token', 
      'grant_type=client_credentials&client_id=' + OLIST_CLIENT_ID + '&client_secret=' + OLIST_CLIENT_SECRET,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    var accessToken = tokenResp.data.access_token;

    // Montar proposta comercial para Olist
    var itensOlist = pedido.itens.map(function(item) {
      return {
        product: { sku: item.sku || item.produtoId, name: item.nome, quantity: item.quantidade },
        quantity: item.quantidade,
        unit_price: item.preco
      };
    });

    var propostaPayload = {
      channel: 'via-panos',
      reference: pedido.numeroPedido,
      customer: {
        name: pedido.cliente.nome,
        email: pedido.cliente.email || 'sem-email@viapanos.com',
        phones: [{ type: 'mobile', number: pedido.cliente.telefone }]
      },
      items: itensOlist,
      note: pedido.observacoes || ''
    };

    var olistResp = await axios.post('https://api.olist.com/commerce/sales-proposals/', propostaPayload,
      { headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' } }
    );

    // Atualizar pedido
    pedido.olistEnviado = true;
    pedido.olistId = String(olistResp.data.id || olistResp.data.reference || '');
    pedido.status = 'confirmado';
    await pedido.save();

    res.json({ ok: true, olistId: pedido.olistId, olistData: olistResp.data });
  } catch (e) {
    var errMsg = e.response ? JSON.stringify(e.response.data) : e.message;
    console.error('Erro Olist:', errMsg);
    res.status(500).json({ erro: 'Erro ao enviar para Olist: ' + errMsg });
  }
});

// ============ DASHBOARD ============
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    var [produtos, clientes, pedidos, pendentes] = await Promise.all([
      Produto.countDocuments(),
      Cliente.countDocuments(),
      Pedido.countDocuments(),
      Pedido.countDocuments({ status: 'pendente' })
    ]);
    res.json({ produtos, clientes, pedidos, pendentes });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ============ PAGES ============
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
